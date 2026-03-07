import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  Animated,
  Vibration,
} from 'react-native';

import {
  getExerciseById,
  getExerciseSetsInSession,
  getLastPerformanceSummary,
  logSet,
  endSession,
  formatDuration,
} from '../db/queries';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_REST_SECONDS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// Rest Timer
// ─────────────────────────────────────────────────────────────────────────────

function useRestTimer() {
  const [restRemaining, setRestRemaining] = useState(null); // null = not running
  const intervalRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const startRest = useCallback((seconds = DEFAULT_REST_SECONDS) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRestRemaining(seconds);

    intervalRef.current = setInterval(() => {
      setRestRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          Vibration.vibrate([0, 300, 100, 300]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopRest = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRestRemaining(null);
  }, []);

  // Pulse animation when ≤ 10 seconds
  useEffect(() => {
    if (restRemaining !== null && restRemaining <= 10 && restRemaining > 0) {
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [restRemaining, pulseAnim]);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  return { restRemaining, startRest, stopRest, pulseAnim };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rest Timer Banner
// ─────────────────────────────────────────────────────────────────────────────

function RestTimerBanner({ remaining, onStop, pulseAnim }) {
  if (remaining === null) return null;

  const isUrgent = remaining <= 10 && remaining > 0;
  const isDone = remaining === 0;

  return (
    <Animated.View
      style={[
        styles.restBanner,
        isUrgent && styles.restBannerUrgent,
        isDone && styles.restBannerDone,
        { transform: [{ scale: pulseAnim }] },
      ]}
    >
      <View style={styles.restBannerLeft}>
        <Text style={styles.restBannerLabel}>{isDone ? 'Rest done!' : 'Rest'}</Text>
        <Text style={styles.restBannerTime}>
          {isDone ? 'Go! 💪' : formatDuration(remaining)}
        </Text>
      </View>
      <TouchableOpacity style={styles.restSkipBtn} onPress={onStop}>
        <Text style={styles.restSkipText}>Skip</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Set Input — adapts to tracking_type
// ─────────────────────────────────────────────────────────────────────────────

function SetInput({ trackingType, values, onChange }) {
  const { weight, reps, duration, toFailure } = values;

  switch (trackingType) {
    case 'weighted':
      return (
        <View style={styles.setInputRow}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Weight (kg)</Text>
            <TextInput
              style={styles.input}
              value={weight}
              onChangeText={(v) => onChange({ weight: v })}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#4b5563"
              selectTextOnFocus
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Reps</Text>
            <TextInput
              style={styles.input}
              value={reps}
              onChangeText={(v) => onChange({ reps: v })}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#4b5563"
              selectTextOnFocus
            />
          </View>

          <View style={styles.inputGroupNarrow}>
            <Text style={styles.inputLabel}>Failure</Text>
            <Switch
              value={toFailure}
              onValueChange={(v) => onChange({ toFailure: v })}
              trackColor={{ false: '#374151', true: '#3b82f6' }}
              thumbColor={toFailure ? '#fff' : '#9ca3af'}
            />
          </View>
        </View>
      );

    case 'timed':
      return (
        <View style={styles.setInputRow}>
          <View style={[styles.inputGroup, { flex: 2 }]}>
            <Text style={styles.inputLabel}>Duration (seconds)</Text>
            <TextInput
              style={styles.input}
              value={duration}
              onChangeText={(v) => onChange({ duration: v })}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#4b5563"
              selectTextOnFocus
            />
          </View>
        </View>
      );

    case 'reps_only':
      return (
        <View style={styles.setInputRow}>
          <View style={[styles.inputGroup, { flex: 2 }]}>
            <Text style={styles.inputLabel}>Reps</Text>
            <TextInput
              style={styles.input}
              value={reps}
              onChangeText={(v) => onChange({ reps: v })}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#4b5563"
              selectTextOnFocus
            />
          </View>
        </View>
      );

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logged Sets List
// ─────────────────────────────────────────────────────────────────────────────

function LoggedSetRow({ set, trackingType, index }) {
  let detail = '';
  if (trackingType === 'weighted') {
    detail = `${set.weight ?? '—'} kg × ${set.reps ?? '—'} reps`;
    if (set.to_failure) detail += ' (failure)';
  } else if (trackingType === 'timed') {
    detail = formatDuration(set.duration ?? 0);
  } else {
    detail = `${set.reps ?? '—'} reps`;
  }

  return (
    <View style={styles.loggedRow}>
      <Text style={styles.loggedSetNum}>Set {index + 1}</Text>
      <Text style={styles.loggedDetail}>{detail}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Last Performance Card
// ─────────────────────────────────────────────────────────────────────────────

function LastPerformanceCard({ summary, trackingType }) {
  if (!summary) return null;

  let lines = [];
  if (trackingType === 'weighted') {
    if (summary.maxWeight != null) lines.push(`Best weight: ${summary.maxWeight} kg`);
    if (summary.avgReps != null) lines.push(`Avg reps: ${summary.avgReps}`);
    lines.push(`Sets: ${summary.setCount}`);
  } else if (trackingType === 'timed') {
    if (summary.maxDuration != null) lines.push(`Best: ${formatDuration(summary.maxDuration)}`);
    lines.push(`Sets: ${summary.setCount}`);
  } else {
    if (summary.avgReps != null) lines.push(`Avg reps: ${summary.avgReps}`);
    lines.push(`Sets: ${summary.setCount}`);
  }

  return (
    <View style={styles.lastPerfCard}>
      <Text style={styles.lastPerfTitle}>Last session</Text>
      {lines.map((l, i) => (
        <Text key={i} style={styles.lastPerfLine}>{l}</Text>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercise Panel
// ─────────────────────────────────────────────────────────────────────────────

function ExercisePanel({ exercise, sessionId, onSetLogged, restTimer }) {
  const { startRest } = restTimer;

  const [inputValues, setInputValues] = useState({
    weight: '',
    reps: '',
    duration: '',
    toFailure: false,
  });
  const [loggedSets, setLoggedSets] = useState([]);
  const [lastPerf, setLastPerf] = useState(null);
  const [logging, setLogging] = useState(false);

  // Load existing sets for this exercise in this session + last performance
  useEffect(() => {
    let active = true;
    (async () => {
      const [sets, perf] = await Promise.all([
        getExerciseSetsInSession(sessionId, exercise.id),
        getLastPerformanceSummary(exercise.id, sessionId),
      ]);
      if (!active) return;
      setLoggedSets(sets);

      // Auto-populate input from last performance
      if (perf) {
        setLastPerf(perf);
        setInputValues((prev) => ({
          ...prev,
          weight: perf.maxWeight != null ? String(perf.maxWeight) : '',
          reps: perf.avgReps != null ? String(perf.avgReps) : '',
          duration: perf.maxDuration != null ? String(perf.maxDuration) : '',
        }));
      }
    })();
    return () => { active = false; };
  }, [exercise.id, sessionId]);

  const handleChange = useCallback((partial) => {
    setInputValues((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleLogSet = useCallback(async () => {
    setLogging(true);
    try {
      const setNumber = loggedSets.length + 1;
      const payload = {
        sessionId,
        exerciseId: exercise.id,
        setNumber,
        toFailure: inputValues.toFailure,
      };

      if (exercise.tracking_type === 'weighted') {
        payload.weight = parseFloat(inputValues.weight) || null;
        payload.reps = parseInt(inputValues.reps, 10) || null;
      } else if (exercise.tracking_type === 'timed') {
        payload.duration = parseInt(inputValues.duration, 10) || null;
      } else {
        payload.reps = parseInt(inputValues.reps, 10) || null;
      }

      await logSet(payload);

      // Refresh logged sets
      const updated = await getExerciseSetsInSession(sessionId, exercise.id);
      setLoggedSets(updated);

      // Start rest timer automatically
      startRest(DEFAULT_REST_SECONDS);

      onSetLogged?.();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLogging(false);
    }
  }, [sessionId, exercise, inputValues, loggedSets, startRest, onSetLogged]);

  return (
    <View style={styles.exercisePanel}>
      {/* Exercise name + tracking type */}
      <View style={styles.exercisePanelHeader}>
        <Text style={styles.exercisePanelName}>{exercise.name}</Text>
        <Text style={styles.exercisePanelType}>{exercise.tracking_type}</Text>
      </View>

      {/* Last performance */}
      <LastPerformanceCard summary={lastPerf} trackingType={exercise.tracking_type} />

      {/* Logged sets so far */}
      {loggedSets.length > 0 && (
        <View style={styles.loggedSets}>
          {loggedSets.map((s, i) => (
            <LoggedSetRow key={s.id} set={s} trackingType={exercise.tracking_type} index={i} />
          ))}
        </View>
      )}

      {/* Input row */}
      <View style={styles.setInputContainer}>
        <Text style={styles.setInputTitle}>Set {loggedSets.length + 1}</Text>
        <SetInput
          trackingType={exercise.tracking_type}
          values={inputValues}
          onChange={handleChange}
        />
      </View>

      {/* Log set button */}
      <TouchableOpacity
        style={[styles.logSetBtn, logging && styles.logSetBtnDisabled]}
        onPress={handleLogSet}
        disabled={logging}
        activeOpacity={0.8}
      >
        <Text style={styles.logSetBtnText}>{logging ? 'Logging…' : '+ Log Set'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ActiveSessionScreen({ navigation, route }) {
  const { sessionId, exerciseIds = [] } = route.params ?? {};

  const [exercises, setExercises] = useState([]);
  const [finishing, setFinishing] = useState(false);
  const restTimer = useRestTimer();
  const { restRemaining, stopRest, pulseAnim } = restTimer;

  useEffect(() => {
    (async () => {
      const loaded = await Promise.all(exerciseIds.map((id) => getExerciseById(id)));
      setExercises(loaded.filter(Boolean));
    })();
  }, [exerciseIds]);

  const handleFinish = useCallback(() => {
    Alert.alert('Finish Session?', 'This will end the session and save all logged sets.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        style: 'destructive',
        onPress: async () => {
          setFinishing(true);
          try {
            await endSession(sessionId);
            navigation.replace('Home');
          } catch (e) {
            Alert.alert('Error', e.message);
            setFinishing(false);
          }
        },
      },
    ]);
  }, [sessionId, navigation]);

  if (!exercises.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Loading session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Rest timer banner — sticky at top */}
      <RestTimerBanner
        remaining={restRemaining}
        onStop={stopRest}
        pulseAnim={pulseAnim}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {exercises.map((ex) => (
          <ExercisePanel
            key={ex.id}
            exercise={ex}
            sessionId={sessionId}
            restTimer={restTimer}
            onSetLogged={() => {}}
          />
        ))}

        {/* Spacer so last exercise isn't hidden by footer */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Finish button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.finishBtn, finishing && styles.finishBtnDisabled]}
          onPress={handleFinish}
          disabled={finishing}
          activeOpacity={0.85}
        >
          <Text style={styles.finishBtnText}>{finishing ? 'Saving…' : 'Finish Session'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  center: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    color: '#9ca3af',
    fontSize: 15,
  },

  // Rest timer banner
  restBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  restBannerUrgent: {
    backgroundColor: '#7c2d12',
  },
  restBannerDone: {
    backgroundColor: '#064e3b',
  },
  restBannerLeft: {
    gap: 2,
  },
  restBannerLabel: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  restBannerTime: {
    color: '#f9fafb',
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  restSkipBtn: {
    backgroundColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  restSkipText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 120,
  },

  // Exercise panel
  exercisePanel: {
    backgroundColor: '#1f2937',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  exercisePanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  exercisePanelName: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  exercisePanelType: {
    color: '#6b7280',
    fontSize: 12,
    marginLeft: 8,
    marginTop: 2,
  },

  // Last performance
  lastPerfCard: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  lastPerfTitle: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  lastPerfLine: {
    color: '#9ca3af',
    fontSize: 13,
  },

  // Logged sets
  loggedSets: {
    marginBottom: 12,
    gap: 4,
  },
  loggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  loggedSetNum: {
    color: '#6b7280',
    fontSize: 13,
    width: 44,
  },
  loggedDetail: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '500',
  },

  // Set input
  setInputContainer: {
    marginBottom: 12,
  },
  setInputTitle: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  setInputRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  inputGroup: {
    flex: 1,
    gap: 4,
  },
  inputGroupNarrow: {
    alignItems: 'center',
    gap: 4,
  },
  inputLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f9fafb',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  // Log set button
  logSetBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logSetBtnDisabled: {
    backgroundColor: '#1f3a6b',
  },
  logSetBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 32,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  finishBtn: {
    backgroundColor: '#065f46',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  finishBtnDisabled: {
    backgroundColor: '#1f2937',
  },
  finishBtnText: {
    color: '#34d399',
    fontSize: 17,
    fontWeight: '700',
  },
});

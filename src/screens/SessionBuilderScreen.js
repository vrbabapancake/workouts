import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  TextInput,
  Animated,
  Alert,
} from 'react-native';

import {
  getAllExercises,
  createSession,
  saveSessionExercises,
  getSessionPlan,
  startPlannedSession,
  getSessionPatternBalance,
  formatPattern,
} from '../db/queries';

// ── Constants ─────────────────────────────────────────────────────────────────

const PATTERN_ORDER = [
  'horizontal_push',
  'horizontal_pull',
  'vertical_push',
  'vertical_pull',
  'hip_hinge',
  'squat',
  'carry',
  'core',
  'isolation',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupExercisesByPattern(exercises) {
  const map = {};
  for (const ex of exercises) {
    const p = ex.movement_pattern;
    if (!map[p]) map[p] = [];
    map[p].push(ex);
  }

  return PATTERN_ORDER
    .filter((p) => map[p]?.length)
    .map((p) => ({ title: formatPattern(p), pattern: p, data: map[p] }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PatternBalanceBar({ balance }) {
  if (!balance.length) return null;

  const maxCount = Math.max(...balance.map((b) => b.count), 1);

  return (
    <View style={styles.balanceContainer}>
      <Text style={styles.balanceTitle}>Pattern balance (last session + this one)</Text>
      {balance.map((item) => (
        <View key={item.movement_pattern} style={styles.balanceRow}>
          <Text style={styles.balanceLabel} numberOfLines={1}>
            {formatPattern(item.movement_pattern)}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${(item.count / maxCount) * 100}%` },
                item.flag === 'heavy' && styles.barHeavy,
              ]}
            />
          </View>
          <Text style={styles.barCount}>{item.count}</Text>
        </View>
      ))}
      {balance.some((b) => b.flag === 'heavy') && (
        <Text style={styles.balanceWarning}>
          Some patterns are heavily weighted — consider balancing your workout.
        </Text>
      )}
    </View>
  );
}

function ExerciseRow({ exercise, isSelected, onToggle }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    onToggle(exercise);
  };

  const trackingBadgeColor = {
    weighted: '#1d4ed8',
    timed: '#7c3aed',
    reps_only: '#065f46',
  }[exercise.tracking_type] || '#374151';

  const trackingLabel = {
    weighted: 'W',
    timed: 'T',
    reps_only: 'R',
  }[exercise.tracking_type] || '?';

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.exerciseRow, isSelected && styles.exerciseRowSelected]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <View style={[styles.trackingBadge, { backgroundColor: trackingBadgeColor }]}>
          <Text style={styles.trackingBadgeText}>{trackingLabel}</Text>
        </View>

        <View style={styles.exerciseInfo}>
          <Text style={[styles.exerciseName, isSelected && styles.exerciseNameSelected]}>
            {exercise.name}
          </Text>
          {exercise.notes ? (
            <Text style={styles.exerciseNotes} numberOfLines={1}>{exercise.notes}</Text>
          ) : null}
        </View>

        <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
          {isSelected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SectionHeader({ title }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SessionBuilderScreen({ navigation, route }) {
  // planSessionId is set when editing an existing planned session
  const planSessionId = route.params?.planSessionId ?? null;

  const [exercises, setExercises] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [balance, setBalance] = useState([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // Load all exercises
  useEffect(() => {
    getAllExercises().then(setExercises);
  }, []);

  // If editing an existing plan, pre-select those exercises
  useEffect(() => {
    if (planSessionId) {
      getSessionPlan(planSessionId).then((planExercises) => {
        setSelectedIds(planExercises.map((e) => e.id));
      });
    }
  }, [planSessionId]);

  // Refresh balance whenever selection changes
  useEffect(() => {
    getSessionPatternBalance(selectedIds).then(setBalance);
  }, [selectedIds]);

  const toggleExercise = useCallback((exercise) => {
    setSelectedIds((prev) =>
      prev.includes(exercise.id)
        ? prev.filter((id) => id !== exercise.id)
        : [...prev, exercise.id]
    );
  }, []);

  const filteredExercises = useMemo(() => {
    if (!query.trim()) return exercises;
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => e.name.toLowerCase().includes(q));
  }, [exercises, query]);

  const sections = useMemo(() => groupExercisesByPattern(filteredExercises), [filteredExercises]);

  // ── Start Now ──────────────────────────────────────────────────────────────

  const handleStartNow = useCallback(async () => {
    if (!selectedIds.length) {
      Alert.alert('No exercises selected', 'Pick at least one exercise to start.');
      return;
    }
    setSaving(true);
    try {
      let sessionId;

      if (planSessionId) {
        // Turn the existing plan into an active session
        await saveSessionExercises(planSessionId, selectedIds);
        await startPlannedSession(planSessionId);
        sessionId = planSessionId;
      } else {
        // Brand new session
        sessionId = await createSession('active');
        await saveSessionExercises(sessionId, selectedIds);
      }

      navigation.replace('ActiveSession', { sessionId });
    } catch (e) {
      Alert.alert('Error', e.message);
      setSaving(false);
    }
  }, [selectedIds, planSessionId, navigation]);

  // ── Plan for Later ─────────────────────────────────────────────────────────

  const handlePlanForLater = useCallback(async () => {
    if (!selectedIds.length) {
      Alert.alert('No exercises selected', 'Pick at least one exercise to save a plan.');
      return;
    }
    setSaving(true);
    try {
      let sessionId;

      if (planSessionId) {
        // Update the existing plan's exercises
        await saveSessionExercises(planSessionId, selectedIds);
        sessionId = planSessionId;
      } else {
        sessionId = await createSession('planned');
        await saveSessionExercises(sessionId, selectedIds);
      }

      navigation.replace('Home');
    } catch (e) {
      Alert.alert('Error', e.message);
      setSaving(false);
    }
  }, [selectedIds, planSessionId, navigation]);

  const isEditing = !!planSessionId;

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search exercises…"
          placeholderTextColor="#6b7280"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Pattern balance indicator */}
      {selectedIds.length > 0 && (
        <PatternBalanceBar balance={balance} />
      )}

      {/* Selected count pill */}
      {selectedIds.length > 0 && (
        <View style={styles.selectedPill}>
          <Text style={styles.selectedPillText}>
            {selectedIds.length} exercise{selectedIds.length !== 1 ? 's' : ''} selected
          </Text>
          <TouchableOpacity onPress={() => setSelectedIds([])}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Exercise list */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
        renderItem={({ item }) => (
          <ExerciseRow
            exercise={item}
            isSelected={selectedIds.includes(item.id)}
            onToggle={toggleExercise}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No exercises found.</Text>
          </View>
        }
      />

      {/* Footer — two buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.planBtn, (!selectedIds.length || saving) && styles.btnDisabled]}
          onPress={handlePlanForLater}
          disabled={!selectedIds.length || saving}
          activeOpacity={0.85}
        >
          <Text style={styles.planBtnText}>
            {saving ? 'Saving…' : isEditing ? 'Update Plan' : 'Plan for Later'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.startBtn, (!selectedIds.length || saving) && styles.btnDisabled]}
          onPress={handleStartNow}
          disabled={!selectedIds.length || saving}
          activeOpacity={0.85}
        >
          <Text style={styles.startBtnText}>
            {saving ? 'Starting…' : `Start Now (${selectedIds.length})`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },

  // Search
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#111827',
  },
  searchInput: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#f9fafb',
    fontSize: 15,
  },

  // Balance
  balanceContainer: {
    backgroundColor: '#1f2937',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  balanceTitle: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  balanceLabel: {
    color: '#d1d5db',
    fontSize: 12,
    width: 110,
    flexShrink: 0,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#374151',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 3,
  },
  barHeavy: {
    backgroundColor: '#f59e0b',
  },
  barCount: {
    color: '#9ca3af',
    fontSize: 11,
    width: 16,
    textAlign: 'right',
  },
  balanceWarning: {
    color: '#f59e0b',
    fontSize: 12,
    marginTop: 8,
  },

  // Selected pill
  selectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1e3a5f',
    borderRadius: 8,
  },
  selectedPillText: {
    color: '#93c5fd',
    fontSize: 13,
    fontWeight: '600',
  },
  clearText: {
    color: '#6b7280',
    fontSize: 13,
  },

  // Section header
  sectionHeader: {
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  sectionHeaderText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Exercise row
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    gap: 12,
  },
  exerciseRowSelected: {
    backgroundColor: '#172554',
  },
  trackingBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  trackingBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '500',
  },
  exerciseNameSelected: {
    color: '#93c5fd',
  },
  exerciseNotes: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkCircleSelected: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  checkMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  // List
  listContent: {
    paddingBottom: 130,
  },
  empty: {
    paddingTop: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
  },

  // Footer — two buttons side by side
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    flexDirection: 'row',
    gap: 10,
  },
  planBtn: {
    flex: 1,
    backgroundColor: '#1e3a5f',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1d4ed8',
  },
  planBtnText: {
    color: '#93c5fd',
    fontSize: 15,
    fontWeight: '600',
  },
  startBtn: {
    flex: 1,
    backgroundColor: '#065f46',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  startBtnText: {
    color: '#34d399',
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.4,
  },
});

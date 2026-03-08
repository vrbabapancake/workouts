import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { getRecentSessions, getPlannedSessions, deleteSession } from '../db/queries';

// ── Glossary ──────────────────────────────────────────────────────────────────

const GLOSSARY_TERMS = [
  { term: 'Pronated grip', def: 'Palms facing down or away from you — like the grip you use for a pull-up.' },
  { term: 'Supinated grip', def: 'Palms facing up or toward you — like holding a bicep curl.' },
  { term: 'Neutral grip', def: 'Palms facing each other — like holding a hammer.' },
  { term: 'Lat', def: 'The large muscle on the sides of your back, just under your armpits. Short for latissimus dorsi.' },
  { term: 'ROM (Range of Motion)', def: 'How far you move through the exercise from start to finish. "Full ROM" means no cutting it short.' },
  { term: 'Hip hinge', def: 'Bending forward at the hips while keeping your back straight — like a deadlift or bowing forward.' },
  { term: 'Compound movement', def: 'An exercise that works multiple muscles and joints at once, like a squat or bench press.' },
  { term: 'Isolation', def: 'An exercise that targets mainly one muscle, like a bicep curl.' },
  { term: 'To failure', def: 'Doing reps until you physically cannot do one more with good form.' },
  { term: 'RPE', def: 'Rate of Perceived Exertion — a 1–10 scale for how hard a set felt. 10 means absolutely nothing left.' },
  { term: 'Dead hang', def: 'Starting a pull-up or lat pulldown with arms fully straight and shoulders relaxed.' },
  { term: 'Brace your core', def: 'Tighten your abs like you are about to take a punch. Protects your spine under load.' },
  { term: 'Rack position', def: 'Weight resting on the front of your shoulders with elbows pointing forward — the start of a front squat.' },
  { term: 'Unilateral', def: 'Working one side of the body at a time — one arm or one leg — to fix strength imbalances.' },
];

function GlossarySection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.glossary}>
      <TouchableOpacity
        style={styles.glossaryHeader}
        onPress={() => setExpanded((e) => !e)}
        activeOpacity={0.75}
      >
        <View>
          <Text style={styles.glossaryTitle}>Gym Terms</Text>
          <Text style={styles.glossarySubtitle}>Plain English definitions</Text>
        </View>
        <Text style={styles.glossaryToggle}>{expanded ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.glossaryBody}>
          {GLOSSARY_TERMS.map(({ term, def }) => (
            <View key={term} style={styles.glossaryRow}>
              <Text style={styles.glossaryTerm}>{term}</Text>
              <Text style={styles.glossaryDef}>{def}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString + (isoString.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString + (isoString.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function durationLabel(started, ended) {
  if (!started || !ended) return null;
  const ms =
    new Date(ended + (ended.endsWith('Z') ? '' : 'Z')).getTime() -
    new Date(started + (started.endsWith('Z') ? '' : 'Z')).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SessionCard({ session, onPress, onDelete }) {
  const dur = durationLabel(session.started_at, session.ended_at);
  const isActive = session.status === 'active';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{formatDate(session.started_at)}</Text>
        <View style={styles.cardHeaderRight}>
          {isActive && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          )}
          {dur && !isActive && <Text style={styles.cardDuration}>{dur}</Text>}
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.cardTime}>{formatTime(session.started_at)}</Text>

      <View style={styles.cardStats}>
        <Stat label="Exercises" value={session.exercise_count ?? 0} />
        <Stat label="Sets" value={session.set_count ?? 0} />
      </View>

      {session.notes ? (
        <Text style={styles.cardNotes} numberOfLines={2}>{session.notes}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

function PlannedCard({ session, onPress, onDelete }) {
  const count = session.exercise_count ?? 0;

  return (
    <TouchableOpacity style={styles.plannedCard} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.plannedCardLeft}>
        <View style={styles.plannedBadge}>
          <Text style={styles.plannedBadgeText}>Planned</Text>
        </View>
        <Text style={styles.plannedExercises}>
          {count} exercise{count !== 1 ? 's' : ''}
        </Text>
      </View>
      <View style={styles.plannedCardRight}>
        <Text style={styles.plannedCta}>Tap to edit or start →</Text>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No sessions yet</Text>
      <Text style={styles.emptySubtitle}>
        Tap "New Workout" to plan or start your first session.
      </Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const [sessions, setSessions] = useState([]);
  const [planned, setPlanned] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [recent, plans] = await Promise.all([
      getRecentSessions(20),
      getPlannedSessions(),
    ]);
    setSessions(recent);
    setPlanned(plans);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSessionPress = useCallback(
    (session) => {
      if (session.status === 'active') {
        navigation.navigate('ActiveSession', { sessionId: session.id });
      }
    },
    [navigation]
  );

  const handlePlannedPress = useCallback(
    (session) => {
      navigation.navigate('SessionBuilder', { planSessionId: session.id });
    },
    [navigation]
  );

  const handleDelete = useCallback(
    (session) => {
      const label = session.status === 'planned' ? 'planned workout' : 'session';
      Alert.alert(
        `Delete this ${label}?`,
        'This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await deleteSession(session.id);
              loadData();
            },
          },
        ]
      );
    },
    [loadData]
  );

  const handleNewWorkout = useCallback(() => {
    navigation.navigate('SessionBuilder');
  }, [navigation]);

  const listData = [
    { type: 'glossary', key: 'glossary' },
    ...(planned.length > 0
      ? [
          { type: 'sectionHeader', key: 'planned-header', label: 'Planned' },
          ...planned.map((s) => ({ type: 'planned', key: `planned-${s.id}`, session: s })),
        ]
      : []),
    { type: 'sectionHeader', key: 'recent-header', label: 'Recent Sessions' },
    ...(sessions.length > 0
      ? sessions.map((s) => ({ type: 'session', key: `session-${s.id}`, session: s }))
      : [{ type: 'empty', key: 'empty' }]),
  ];

  return (
    <View style={styles.container}>
      <FlatList
        data={listData}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
        renderItem={({ item }) => {
          if (item.type === 'glossary') return <GlossarySection />;
          if (item.type === 'sectionHeader') {
            return (
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>{item.label}</Text>
              </View>
            );
          }
          if (item.type === 'planned') {
            return (
              <PlannedCard
                session={item.session}
                onPress={() => handlePlannedPress(item.session)}
                onDelete={() => handleDelete(item.session)}
              />
            );
          }
          if (item.type === 'session') {
            return (
              <SessionCard
                session={item.session}
                onPress={() => handleSessionPress(item.session)}
                onDelete={() => handleDelete(item.session)}
              />
            );
          }
          if (item.type === 'empty') return <EmptyState />;
          return null;
        }}
      />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.startButton} onPress={handleNewWorkout} activeOpacity={0.85}>
          <Text style={styles.startButtonText}>New Workout</Text>
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
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },

  // Glossary
  glossary: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    marginBottom: 20,
    overflow: 'hidden',
  },
  glossaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  glossaryTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
  },
  glossarySubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 1,
  },
  glossaryToggle: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '500',
  },
  glossaryBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  glossaryRow: {
    paddingTop: 12,
    gap: 2,
  },
  glossaryTerm: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },
  glossaryDef: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
  },

  // Section headers
  sectionHeaderRow: {
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '700',
  },

  // Planned card
  plannedCard: {
    backgroundColor: '#1e3a5f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#1d4ed8',
  },
  plannedCardLeft: {
    gap: 4,
  },
  plannedCardRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  plannedBadge: {
    backgroundColor: '#1d4ed8',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  plannedBadgeText: {
    color: '#bfdbfe',
    fontSize: 11,
    fontWeight: '600',
  },
  plannedExercises: {
    color: '#93c5fd',
    fontSize: 14,
    fontWeight: '500',
  },
  plannedCta: {
    color: '#6b7280',
    fontSize: 12,
  },

  // Session card
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardDate: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
  },
  cardDuration: {
    color: '#6b7280',
    fontSize: 13,
  },
  cardTime: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 10,
  },
  cardStats: {
    flexDirection: 'row',
    gap: 24,
  },
  cardNotes: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
  },
  activeBadge: {
    backgroundColor: '#065f46',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  activeBadgeText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '600',
  },

  // Delete button
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: {
    color: '#4b5563',
    fontSize: 14,
    fontWeight: '600',
  },

  // Stats
  stat: {
    alignItems: 'flex-start',
  },
  statValue: {
    color: '#3b82f6',
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 1,
  },

  // Empty
  empty: {
    paddingTop: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
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
  startButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});

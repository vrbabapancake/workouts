import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { getRecentSessions } from '../db/queries';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function SessionCard({ session, onPress }) {
  const dur = durationLabel(session.started_at, session.ended_at);
  const isActive = !session.ended_at;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{formatDate(session.started_at)}</Text>
        {isActive && <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Active</Text></View>}
        {dur && !isActive && <Text style={styles.cardDuration}>{dur}</Text>}
      </View>

      <Text style={styles.cardTime}>{formatTime(session.started_at)}</Text>

      <View style={styles.cardStats}>
        <Stat label="Exercises" value={session.exercise_count ?? 0} />
        <Stat label="Sets" value={session.set_count ?? 0} />
      </View>

      {session.notes ? <Text style={styles.cardNotes} numberOfLines={2}>{session.notes}</Text> : null}
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
      <Text style={styles.emptySubtitle}>Tap "Start Workout" to log your first session.</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const [sessions, setSessions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadSessions = useCallback(async () => {
    const rows = await getRecentSessions(20);
    setSessions(rows);
  }, []);

  // Reload when navigating back from Active Session
  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const handleSessionPress = useCallback(
    (session) => {
      if (!session.ended_at) {
        // Resume active session
        navigation.navigate('ActiveSession', { sessionId: session.id });
      }
      // Past sessions: could navigate to a detail view (future feature)
    },
    [navigation]
  );

  const handleStartWorkout = useCallback(() => {
    navigation.navigate('SessionBuilder');
  }, [navigation]);

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>Recent Sessions</Text>
          </View>
        }
        renderItem={({ item }) => (
          <SessionCard session={item} onPress={() => handleSessionPress(item)} />
        )}
      />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.startButton} onPress={handleStartWorkout} activeOpacity={0.85}>
          <Text style={styles.startButtonText}>Start Workout</Text>
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
    paddingBottom: 100,
  },
  listHeader: {
    paddingTop: 20,
    paddingBottom: 12,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 20,
    fontWeight: '700',
  },

  // Card
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
    paddingTop: 60,
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

  // Footer / CTA
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

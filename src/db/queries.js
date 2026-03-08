import { getDb } from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// Exercises
// ─────────────────────────────────────────────────────────────────────────────

/** Return all active exercises, ordered by movement pattern then name. */
export async function getAllExercises() {
  const db = await getDb();
  return db.getAllAsync(`
    SELECT * FROM exercises
    WHERE is_active = 1
    ORDER BY movement_pattern, name
  `);
}

/** Return a single exercise by id. */
export async function getExerciseById(id) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM exercises WHERE id = ?`, [id]);
}

/** Search exercises by name fragment. */
export async function searchExercises(query) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM exercises WHERE is_active = 1 AND name LIKE ? ORDER BY name`,
    [`%${query}%`]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new session.
 * status: 'active' (start now) | 'planned' (plan for later)
 */
export async function createSession(status = 'active') {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO sessions (started_at, status)
     VALUES (CASE WHEN ? = 'active' THEN datetime('now') ELSE NULL END, ?)`,
    [status, status]
  );
  return result.lastInsertRowId;
}

/**
 * Save the list of exercises for a session (replaces any previous list).
 * Call this right after createSession or when updating a plan.
 */
export async function saveSessionExercises(sessionId, exerciseIds) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM session_exercises WHERE session_id = ?`, [sessionId]);
  for (let i = 0; i < exerciseIds.length; i++) {
    await db.runAsync(
      `INSERT OR IGNORE INTO session_exercises (session_id, exercise_id, sort_order) VALUES (?, ?, ?)`,
      [sessionId, exerciseIds[i], i]
    );
  }
}

/**
 * Return the exercises saved to a session (from session_exercises table),
 * ordered by sort_order.
 */
export async function getSessionPlan(sessionId) {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT e.*
    FROM session_exercises se
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.session_id = ?
    ORDER BY se.sort_order
    `,
    [sessionId]
  );
}

/** Start a planned session — sets status to active and records the start time. */
export async function startPlannedSession(sessionId) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET status = 'active', started_at = datetime('now') WHERE id = ?`,
    [sessionId]
  );
}

/** End a session — marks it as completed. */
export async function endSession(sessionId, notes = null) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET ended_at = datetime('now'), status = 'completed', notes = ? WHERE id = ?`,
    [notes, sessionId]
  );
}

/** Delete a session and all its sets (cascades via foreign key). */
export async function deleteSession(sessionId) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}

/** Return recent active/completed sessions with set counts. */
export async function getRecentSessions(limit = 20) {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT
      s.id,
      s.started_at,
      s.ended_at,
      s.notes,
      s.status,
      COUNT(DISTINCT st.exercise_id) AS exercise_count,
      COUNT(st.id)                   AS set_count
    FROM sessions s
    LEFT JOIN sets st ON st.session_id = s.id
    WHERE s.status IN ('active', 'completed')
    GROUP BY s.id
    ORDER BY s.started_at DESC
    LIMIT ?
    `,
    [limit]
  );
}

/** Return all planned sessions with their exercise count from session_exercises. */
export async function getPlannedSessions() {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT
      s.id,
      s.started_at,
      s.ended_at,
      s.notes,
      s.status,
      COUNT(se.id) AS exercise_count
    FROM sessions s
    LEFT JOIN session_exercises se ON se.session_id = s.id
    WHERE s.status = 'planned'
    GROUP BY s.id
    ORDER BY s.id DESC
    `
  );
}

/** Return one session with full detail. */
export async function getSessionById(sessionId) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
}

/** Return all sets in a session, joined with exercise names. */
export async function getSessionSets(sessionId) {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT
      st.*,
      e.name            AS exercise_name,
      e.tracking_type,
      e.movement_pattern
    FROM sets st
    JOIN exercises e ON e.id = st.exercise_id
    WHERE st.session_id = ?
    ORDER BY st.logged_at, st.set_number
    `,
    [sessionId]
  );
}

/** Return unique exercises used in a session, ordered by first logged set. */
export async function getSessionExercises(sessionId) {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT DISTINCT
      e.id,
      e.name,
      e.tracking_type,
      e.movement_pattern,
      e.default_sets,
      e.default_reps,
      e.default_weight,
      e.default_duration,
      MIN(st.logged_at) AS first_logged
    FROM sets st
    JOIN exercises e ON e.id = st.exercise_id
    WHERE st.session_id = ?
    GROUP BY e.id
    ORDER BY first_logged
    `,
    [sessionId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a set. Pass whichever fields are relevant for the tracking_type:
 *   weighted  → weight, reps, to_failure
 *   timed     → duration
 *   reps_only → reps
 */
export async function logSet({
  sessionId,
  exerciseId,
  setNumber,
  weight = null,
  reps = null,
  duration = null,
  toFailure = 0,
  rpe = null,
  notes = null,
}) {
  const db = await getDb();
  const result = await db.runAsync(
    `
    INSERT INTO sets
      (session_id, exercise_id, set_number, weight, reps, duration, to_failure, rpe, notes, logged_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    [sessionId, exerciseId, setNumber, weight, reps, duration, toFailure ? 1 : 0, rpe, notes]
  );

  const setId = result.lastInsertRowId;
  await _checkAndUpdatePRs(db, exerciseId, setId, { weight, reps, duration });
  return setId;
}

/** Delete a set by id. */
export async function deleteSet(setId) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sets WHERE id = ?`, [setId]);
}

/** Return all sets for an exercise in a specific session. */
export async function getExerciseSetsInSession(sessionId, exerciseId) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM sets WHERE session_id = ? AND exercise_id = ? ORDER BY set_number`,
    [sessionId, exerciseId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Last Performance
// ─────────────────────────────────────────────────────────────────────────────

export async function getLastPerformance(exerciseId, currentSessionId = null) {
  const db = await getDb();

  const args = currentSessionId ? [exerciseId, currentSessionId] : [exerciseId];
  const whereClause = currentSessionId ? `AND st.session_id != ?` : '';

  const lastSession = await db.getFirstAsync(
    `
    SELECT st.session_id, MAX(st.logged_at) AS last_logged
    FROM sets st
    WHERE st.exercise_id = ? ${whereClause}
    GROUP BY st.session_id
    ORDER BY last_logged DESC
    LIMIT 1
    `,
    args
  );

  if (!lastSession) return [];

  return db.getAllAsync(
    `SELECT * FROM sets WHERE session_id = ? AND exercise_id = ? ORDER BY set_number`,
    [lastSession.session_id, exerciseId]
  );
}

export async function getLastPerformanceSummary(exerciseId, currentSessionId = null) {
  const sets = await getLastPerformance(exerciseId, currentSessionId);
  if (!sets.length) return null;

  const weights = sets.map((s) => s.weight).filter(Boolean);
  const reps = sets.map((s) => s.reps).filter(Boolean);
  const durations = sets.map((s) => s.duration).filter(Boolean);

  return {
    sets,
    maxWeight: weights.length ? Math.max(...weights) : null,
    avgReps: reps.length ? Math.round(reps.reduce((a, b) => a + b, 0) / reps.length) : null,
    maxDuration: durations.length ? Math.max(...durations) : null,
    setCount: sets.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal Records
// ─────────────────────────────────────────────────────────────────────────────

async function _checkAndUpdatePRs(db, exerciseId, setId, { weight, reps, duration }) {
  if (weight) {
    const existing = await db.getFirstAsync(
      `SELECT value FROM personal_records WHERE exercise_id = ? AND pr_type = 'max_weight'`,
      [exerciseId]
    );
    if (!existing || weight > existing.value) {
      await db.runAsync(
        `INSERT OR REPLACE INTO personal_records (exercise_id, pr_type, value, set_id, achieved_at)
         VALUES (?, 'max_weight', ?, ?, datetime('now'))`,
        [exerciseId, weight, setId]
      );
    }
  }

  if (weight && reps) {
    const volume = weight * reps;
    const existing = await db.getFirstAsync(
      `SELECT value FROM personal_records WHERE exercise_id = ? AND pr_type = 'max_volume'`,
      [exerciseId]
    );
    if (!existing || volume > existing.value) {
      await db.runAsync(
        `INSERT OR REPLACE INTO personal_records (exercise_id, pr_type, value, set_id, achieved_at)
         VALUES (?, 'max_volume', ?, ?, datetime('now'))`,
        [exerciseId, volume, setId]
      );
    }
  }

  if (reps && !weight) {
    const existing = await db.getFirstAsync(
      `SELECT value FROM personal_records WHERE exercise_id = ? AND pr_type = 'max_reps'`,
      [exerciseId]
    );
    if (!existing || reps > existing.value) {
      await db.runAsync(
        `INSERT OR REPLACE INTO personal_records (exercise_id, pr_type, value, set_id, achieved_at)
         VALUES (?, 'max_reps', ?, ?, datetime('now'))`,
        [exerciseId, reps, setId]
      );
    }
  }

  if (duration) {
    const existing = await db.getFirstAsync(
      `SELECT value FROM personal_records WHERE exercise_id = ? AND pr_type = 'max_duration'`,
      [exerciseId]
    );
    if (!existing || duration > existing.value) {
      await db.runAsync(
        `INSERT OR REPLACE INTO personal_records (exercise_id, pr_type, value, set_id, achieved_at)
         VALUES (?, 'max_duration', ?, ?, datetime('now'))`,
        [exerciseId, duration, setId]
      );
    }
  }
}

/** Return PRs for a given exercise. */
export async function getPRs(exerciseId) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM personal_records WHERE exercise_id = ? ORDER BY achieved_at DESC`,
    [exerciseId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Balance (rolling 2-session window)
// ─────────────────────────────────────────────────────────────────────────────

export async function getPatternCountsForLastNSessions(n = 2) {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT
      e.movement_pattern,
      COUNT(DISTINCT st.exercise_id || '-' || st.session_id) AS exercise_occurrences
    FROM sets st
    JOIN exercises e ON e.id = st.exercise_id
    JOIN sessions s  ON s.id = st.session_id
    WHERE s.status = 'completed'
      AND s.id IN (
        SELECT id FROM sessions
        WHERE status = 'completed'
        ORDER BY started_at DESC
        LIMIT ?
      )
    GROUP BY e.movement_pattern
    ORDER BY exercise_occurrences DESC
    `,
    [n]
  );
}

export async function getSessionPatternBalance(selectedExerciseIds) {
  const db = await getDb();

  const historyCounts = await getPatternCountsForLastNSessions(1);
  const historyMap = {};
  for (const row of historyCounts) {
    historyMap[row.movement_pattern] = (historyMap[row.movement_pattern] || 0) + row.exercise_occurrences;
  }

  const selectedMap = {};
  for (const id of selectedExerciseIds) {
    const ex = await db.getFirstAsync(
      `SELECT movement_pattern FROM exercises WHERE id = ?`,
      [id]
    );
    if (ex) {
      selectedMap[ex.movement_pattern] = (selectedMap[ex.movement_pattern] || 0) + 1;
    }
  }

  const allPatterns = new Set([...Object.keys(historyMap), ...Object.keys(selectedMap)]);
  const result = [];

  for (const pattern of allPatterns) {
    const count = (historyMap[pattern] || 0) + (selectedMap[pattern] || 0);
    result.push({ movement_pattern: pattern, count });
  }

  result.sort((a, b) => b.count - a.count);

  const maxCount = result.length ? result[0].count : 0;
  const minCount = result.length ? result[result.length - 1].count : 0;

  return result.map((r) => ({
    ...r,
    flag: maxCount > 0 && r.count === maxCount && maxCount - minCount >= 2 ? 'heavy' : 'ok',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown Check
// ─────────────────────────────────────────────────────────────────────────────

export async function isExerciseOnCooldown(exerciseId) {
  const db = await getDb();
  const exercise = await db.getFirstAsync(
    `SELECT cooldown_days FROM exercises WHERE id = ?`,
    [exerciseId]
  );
  if (!exercise) return false;

  const recent = await db.getFirstAsync(
    `
    SELECT st.logged_at
    FROM sets st
    JOIN sessions s ON s.id = st.session_id
    WHERE st.exercise_id = ?
      AND s.status = 'completed'
    ORDER BY st.logged_at DESC
    LIMIT 1
    `,
    [exerciseId]
  );

  if (!recent) return false;

  const daysSince =
    (Date.now() - new Date(recent.logged_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);

  return daysSince < exercise.cooldown_days;
}

export async function getCooldownStatus() {
  const db = await getDb();
  const exercises = await getAllExercises();
  const results = [];

  for (const ex of exercises) {
    const recent = await db.getFirstAsync(
      `
      SELECT st.logged_at
      FROM sets st
      JOIN sessions s ON s.id = st.session_id
      WHERE st.exercise_id = ?
        AND s.status = 'completed'
      ORDER BY st.logged_at DESC
      LIMIT 1
      `,
      [ex.id]
    );

    const daysSince = recent
      ? (Date.now() - new Date(recent.logged_at + 'Z').getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    results.push({
      exercise_id: ex.id,
      exercise_name: ex.name,
      on_cooldown: daysSince < ex.cooldown_days,
      days_since_last: daysSince === Infinity ? null : Math.round(daysSince * 10) / 10,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Program / Pool
// ─────────────────────────────────────────────────────────────────────────────

export async function addToProgram(exerciseId) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO program_exercises (exercise_id) VALUES (?)`,
    [exerciseId]
  );
}

export async function removeFromProgram(exerciseId) {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM program_exercises WHERE exercise_id = ?`,
    [exerciseId]
  );
}

export async function getProgramExercises() {
  const db = await getDb();
  return db.getAllAsync(
    `
    SELECT e.*
    FROM program_exercises pe
    JOIN exercises e ON e.id = pe.exercise_id
    WHERE pe.is_active = 1
    ORDER BY pe.sort_order, e.name
    `
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function formatPattern(pattern) {
  return pattern
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

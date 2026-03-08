import * as SQLite from 'expo-sqlite';

let db = null;

export async function getDb() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('workout_tracker.db');
  return db;
}

const SCHEMA_VERSION = 1;

export async function initDb() {
  const database = await getDb();

  await database.execAsync(`PRAGMA journal_mode = WAL;`);
  await database.execAsync(`PRAGMA foreign_keys = OFF;`);

  // If schema version doesn't match, drop everything and start fresh
  const versionRow = await database.getFirstAsync(`PRAGMA user_version`);
  if (versionRow.user_version !== SCHEMA_VERSION) {
    await database.execAsync(`
      DROP TABLE IF EXISTS personal_records;
      DROP TABLE IF EXISTS sets;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS program_exercises;
      DROP TABLE IF EXISTS exercise_equipment;
      DROP TABLE IF EXISTS exercise_modifiers;
      DROP TABLE IF EXISTS exercises;
      DROP TABLE IF EXISTS movement_patterns;
      DROP TABLE IF EXISTS equipment;
      DROP TABLE IF EXISTS modifiers;
    `);
    await database.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  await database.execAsync(`PRAGMA foreign_keys = ON;`);

  // ── Movement Patterns ─────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS movement_patterns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      description TEXT
    );
  `);

  // ── Equipment ─────────────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS equipment (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL UNIQUE
    );
  `);

  // ── Modifiers ─────────────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS modifiers (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL UNIQUE
    );
  `);

  // ── Exercises ─────────────────────────────────────────────────────────────
  // tracking_type: 'weighted' | 'timed' | 'reps_only'
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS exercises (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT    NOT NULL UNIQUE,
      movement_pattern  TEXT    NOT NULL,
      tracking_type     TEXT    NOT NULL DEFAULT 'weighted'
                        CHECK(tracking_type IN ('weighted','timed','reps_only')),
      default_sets      INTEGER NOT NULL DEFAULT 3,
      default_reps      INTEGER,
      default_weight    REAL,
      default_duration  INTEGER,
      cooldown_days     INTEGER NOT NULL DEFAULT 1,
      notes             TEXT,
      is_active         INTEGER NOT NULL DEFAULT 1
    );
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_exercises_pattern
      ON exercises(movement_pattern);
  `);

  // ── Exercise Equipment join ───────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS exercise_equipment (
      exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
      PRIMARY KEY (exercise_id, equipment_id)
    );
  `);

  // ── Exercise Modifiers join ───────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS exercise_modifiers (
      exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      modifier_id  INTEGER NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
      PRIMARY KEY (exercise_id, modifier_id)
    );
  `);

  // ── Sessions ──────────────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT    NOT NULL DEFAULT (datetime('now')),
      ended_at   TEXT,
      notes      TEXT
    );
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at
      ON sessions(started_at DESC);
  `);

  // ── Sets ──────────────────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS sets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      set_number  INTEGER NOT NULL DEFAULT 1,
      weight      REAL,
      reps        INTEGER,
      duration    INTEGER,
      to_failure  INTEGER NOT NULL DEFAULT 0,
      rpe         REAL,
      notes       TEXT,
      logged_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_sets_session
      ON sets(session_id);
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_sets_exercise
      ON sets(exercise_id, logged_at DESC);
  `);

  // ── Personal Records ──────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS personal_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      pr_type     TEXT    NOT NULL,  -- 'max_weight', 'max_reps', 'max_volume', 'max_duration'
      value       REAL    NOT NULL,
      set_id      INTEGER REFERENCES sets(id),
      achieved_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_prs_exercise
      ON personal_records(exercise_id, pr_type);
  `);

  // ── Program / Pool ────────────────────────────────────────────────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS program_exercises (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────
  // Seed data
  // ─────────────────────────────────────────────────────────────────────────
  await _seedMovementPatterns(database);
  await _seedEquipment(database);
  await _seedModifiers(database);
  await _seedExercises(database);
}

async function _seedMovementPatterns(db) {
  await db.execAsync(`
    INSERT OR IGNORE INTO movement_patterns (name, description) VALUES
      ('horizontal_push',  'Pushing away from the body horizontally (e.g. bench press)'),
      ('horizontal_pull',  'Pulling toward the body horizontally (e.g. row)'),
      ('vertical_push',    'Pushing overhead (e.g. shoulder press)'),
      ('vertical_pull',    'Pulling downward from overhead (e.g. lat pulldown)'),
      ('hip_hinge',        'Hip-dominant posterior-chain movement (e.g. deadlift, RDL)'),
      ('squat',            'Knee-dominant lower-body movement (e.g. squat, leg press)'),
      ('carry',            'Loaded carry or stabilisation (e.g. farmer carry)'),
      ('core',             'Trunk stability or flexion/extension'),
      ('isolation',        'Single-joint accessory movement');
  `);
}

async function _seedEquipment(db) {
  await db.execAsync(`
    INSERT OR IGNORE INTO equipment (name) VALUES
      ('barbell'),
      ('dumbbell'),
      ('cable'),
      ('machine'),
      ('kettlebell'),
      ('bodyweight'),
      ('band'),
      ('ez_bar');
  `);
}

async function _seedModifiers(db) {
  await db.execAsync(`
    INSERT OR IGNORE INTO modifiers (name) VALUES
      ('paused'),
      ('tempo'),
      ('supinated_grip'),
      ('pronated_grip'),
      ('neutral_grip'),
      ('unilateral'),
      ('incline'),
      ('decline'),
      ('close_grip'),
      ('wide_grip');
  `);
}

async function _seedExercises(db) {
  // 12 exercises from a typical Push/Pull/Legs-style routine
  await db.execAsync(`
    INSERT OR IGNORE INTO exercises
      (name, movement_pattern, tracking_type, default_sets, default_reps, default_weight, cooldown_days, notes)
    VALUES
      -- Horizontal Push
      ('Bench Press',           'horizontal_push', 'weighted',  4, 8,  60.0, 1, 'Compound chest movement'),
      ('Incline Dumbbell Press','horizontal_push', 'weighted',  3, 10, 22.5, 1, 'Upper chest emphasis'),

      -- Horizontal Pull
      ('Barbell Row',           'horizontal_pull', 'weighted',  4, 8,  60.0, 1, 'Pronated grip, brace core'),
      ('Seated Cable Row',      'horizontal_pull', 'weighted',  3, 12, 50.0, 1, 'Keep chest tall'),

      -- Vertical Push
      ('Overhead Press',        'vertical_push',   'weighted',  4, 6,  40.0, 1, 'Strict press, no leg drive'),

      -- Vertical Pull
      ('Pull-Up',               'vertical_pull',   'reps_only', 4, 8,  NULL, 1, 'Full ROM, dead hang start'),
      ('Lat Pulldown',          'vertical_pull',   'weighted',  3, 12, 55.0, 1, 'Wide pronated grip'),

      -- Hip Hinge
      ('Romanian Deadlift',     'hip_hinge',       'weighted',  3, 10, 80.0, 1, 'Soft knees, hinge to mid-shin'),
      ('Hip Thrust',            'hip_hinge',       'weighted',  3, 12, 80.0, 1, 'Full hip extension at top'),

      -- Squat
      ('Squat',                 'squat',           'weighted',  4, 8,  80.0, 1, 'High bar, below parallel'),
      ('Leg Press',             'squat',           'weighted',  3, 12, 120.0,1, 'Feet shoulder width, full depth'),

      -- Core
      ('Plank',                 'core',            'timed',     3, NULL,NULL, 1, 'Neutral spine, breathe');
  `);
}

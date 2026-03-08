import * as SQLite from 'expo-sqlite';

let db = null;

export async function getDb() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('workout_tracker.db');
  return db;
}

const SCHEMA_VERSION = 2;

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
      DROP TABLE IF EXISTS session_exercises;
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
      description       TEXT,
      form_tip          TEXT,
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
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  TEXT,
      ended_at    TEXT,
      notes       TEXT,
      status      TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('planned','active','completed')),
      planned_for TEXT
    );
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at
      ON sessions(started_at DESC);
  `);

  // ── Session Exercises (planned exercise list for a session) ───────────────
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS session_exercises (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      sort_order  INTEGER NOT NULL DEFAULT 0,
      UNIQUE(session_id, exercise_id)
    );
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
      pr_type     TEXT    NOT NULL,
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
      ('horizontal_push',  'Pushing away from the body horizontally'),
      ('horizontal_pull',  'Pulling toward the body horizontally'),
      ('vertical_push',    'Pushing overhead'),
      ('vertical_pull',    'Pulling downward from overhead'),
      ('hip_hinge',        'Hip-dominant movement like a deadlift or RDL'),
      ('squat',            'Knee-dominant lower-body movement'),
      ('carry',            'Loaded carry or walking with weight'),
      ('core',             'Trunk stability or ab work'),
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
  const exercises = [
    // ── Horizontal Push ──────────────────────────────────────────────────
    {
      name: 'Bench Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 4, reps: 8, weight: 60.0, cooldown: 1,
      notes: 'Flat bar, full range',
      description: 'Push a barbell off your chest while lying flat on a bench. Works your chest, shoulders, and triceps.',
      tip: 'Pinch your shoulder blades together and keep them there throughout the whole set.',
    },
    {
      name: 'Incline Dumbbell Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 10, weight: 22.5, cooldown: 1,
      notes: 'Upper chest, 30-45 degree angle',
      description: 'Like a bench press but on an upward angle, which hits the upper chest more.',
      tip: 'Lower the dumbbells slowly until you feel a stretch in your chest, then press up.',
    },
    {
      name: 'Decline Bench Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 4, reps: 8, weight: 55.0, cooldown: 1,
      notes: 'Head lower than hips, lower chest focus',
      description: 'Bench press with your head lower than your hips. Targets the lower chest more than a flat bench.',
      tip: 'Use a spotter — the angle makes it harder to rack the bar safely on your own.',
    },
    {
      name: 'Dumbbell Bench Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 10, weight: 22.5, cooldown: 1,
      notes: 'More range than barbell',
      description: 'Same as a barbell bench press but with dumbbells, giving each arm more freedom to move.',
      tip: 'At the bottom, elbows should be around 45 degrees — not flared straight out to the sides.',
    },
    {
      name: 'Close-Grip Bench Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 8, weight: 50.0, cooldown: 1,
      notes: 'Hands shoulder-width, triceps focus',
      description: 'Bench press with hands closer together. Shifts the work from chest to triceps.',
      tip: 'Keep your elbows close to your sides as you press — they should not flare out wide.',
    },
    {
      name: 'Push-Up',
      pattern: 'horizontal_push', type: 'reps_only', sets: 3, reps: 15, weight: null, cooldown: 1,
      notes: 'Keep body in a straight line',
      description: 'The classic — lower your chest to the floor and push back up. No equipment needed.',
      tip: 'Keep your body in a straight line from head to heels. Do not let your hips sag down.',
    },
    {
      name: 'Cable Chest Fly',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 12, weight: 15.0, cooldown: 1,
      notes: 'Arms wide, arc inward',
      description: 'Arms wide, arc them together in front of you using cables. Stretches and squeezes the chest.',
      tip: 'Keep a slight bend in your elbows the whole time and move slowly through the full arc.',
    },
    {
      name: 'Dumbbell Fly',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 12, weight: 14.0, cooldown: 1,
      notes: 'Slight bend in elbows throughout',
      description: 'Lie flat, hold dumbbells above your chest, lower them out to the sides then bring back up.',
      tip: 'Think of hugging a big barrel — arms wide but never fully straight.',
    },
    {
      name: 'Machine Chest Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 12, weight: 50.0, cooldown: 1,
      notes: 'Control the full range',
      description: 'Push handles away from your chest on a machine. Great if you are training alone.',
      tip: 'Do not let the weight stack touch down between reps — keep it under control.',
    },
    {
      name: 'Decline Dumbbell Press',
      pattern: 'horizontal_push', type: 'weighted', sets: 3, reps: 10, weight: 20.0, cooldown: 1,
      notes: 'Head lower, lower chest emphasis',
      description: 'Dumbbell press on a downward angle. Targets the lower part of the chest.',
      tip: 'Set the bench first, then get into position — it is awkward to adjust once you are lying down.',
    },

    // ── Horizontal Pull ──────────────────────────────────────────────────
    {
      name: 'Barbell Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 4, reps: 8, weight: 60.0, cooldown: 1,
      notes: 'Overhand grip, keep back flat',
      description: 'Pull a barbell up to your stomach while bent over. One of the best back builders there is.',
      tip: 'Keep your back flat — do not round your spine. Pull your elbows behind you, not just the bar up.',
    },
    {
      name: 'Seated Cable Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 3, reps: 12, weight: 50.0, cooldown: 1,
      notes: 'Sit tall, squeeze shoulder blades',
      description: 'Pull a cable handle into your stomach while sitting upright. Great for your mid-back.',
      tip: 'Sit tall throughout — do not lean back to cheat the weight up.',
    },
    {
      name: 'Dumbbell Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 3, reps: 10, weight: 25.0, cooldown: 1,
      notes: 'Knee on bench, pull to hip',
      description: 'One knee on a bench, pull a dumbbell up to your hip. Lets you focus on one side at a time.',
      tip: 'Let the weight hang fully at the bottom, then pull your elbow straight back toward your hip.',
    },
    {
      name: 'T-Bar Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 4, reps: 8, weight: 60.0, cooldown: 1,
      notes: 'Chest on pad, pull to chest',
      description: 'Row with a bar anchored at one end. Lets you load heavy.',
      tip: 'Squeeze hard at the top — the bar should come all the way to your chest or stomach.',
    },
    {
      name: 'Machine Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 3, reps: 12, weight: 50.0, cooldown: 1,
      notes: 'Squeeze shoulder blades at top',
      description: 'Sitting row on a machine. Good for beginners or when your lower back needs a rest.',
      tip: 'Do not just go through the motion — squeeze your shoulder blades together at the top of each rep.',
    },
    {
      name: 'Chest-Supported Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 3, reps: 12, weight: 20.0, cooldown: 1,
      notes: 'Chest on bench, no lower back strain',
      description: 'Lie face-down on an incline bench and row dumbbells up. No lower back strain at all.',
      tip: 'Let your arms hang fully at the bottom, then drive your elbows up and back.',
    },
    {
      name: 'Inverted Row',
      pattern: 'horizontal_pull', type: 'reps_only', sets: 3, reps: 10, weight: null, cooldown: 1,
      notes: 'Body straight, pull chest to bar',
      description: 'Hang under a bar and pull your chest up to it. Like a reverse push-up for your back.',
      tip: 'Keep your body straight like a plank — do not let your hips drop toward the floor.',
    },
    {
      name: 'Pendlay Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 4, reps: 6, weight: 60.0, cooldown: 1,
      notes: 'Bar touches floor between every rep',
      description: 'Like a barbell row but stricter — the bar fully rests on the floor between each rep.',
      tip: 'No momentum. Let the bar rest, set your back flat, then pull from a dead stop.',
    },
    {
      name: 'Cable Row Wide Grip',
      pattern: 'horizontal_pull', type: 'weighted', sets: 3, reps: 12, weight: 45.0, cooldown: 1,
      notes: 'Wide grip, upper back focus',
      description: 'Seated cable row with a wide grip, which hits the upper back more than a close grip.',
      tip: 'Pull the bar to your upper chest and squeeze your shoulder blades together.',
    },
    {
      name: 'Meadows Row',
      pattern: 'horizontal_pull', type: 'weighted', sets: 3, reps: 10, weight: 40.0, cooldown: 1,
      notes: 'Barbell anchored at floor, one arm',
      description: 'A one-arm row using a barbell anchored at the floor. Works the outer back well.',
      tip: 'Pull the bar up toward your armpit and drive your elbow toward the ceiling.',
    },

    // ── Vertical Push ────────────────────────────────────────────────────
    {
      name: 'Overhead Press',
      pattern: 'vertical_push', type: 'weighted', sets: 4, reps: 6, weight: 40.0, cooldown: 1,
      notes: 'Press from shoulders, no leg push',
      description: 'Press a barbell straight up over your head from shoulder height. The main shoulder exercise.',
      tip: 'Brace your core hard and do not arch your lower back. Lock the bar out fully at the top.',
    },
    {
      name: 'Dumbbell Shoulder Press',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 10, weight: 20.0, cooldown: 1,
      notes: 'Press from ear height upward',
      description: 'Same as an overhead press but with dumbbells, working each shoulder independently.',
      tip: 'Start with dumbbells at ear height — starting too low puts extra strain on your shoulders.',
    },
    {
      name: 'Arnold Press',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 10, weight: 15.0, cooldown: 1,
      notes: 'Rotate palms as you press up',
      description: 'Start with palms facing you, rotate outward as you press up. Named after Arnold Schwarzenegger.',
      tip: 'The rotation is the whole point — go slowly and feel each part of your shoulder working.',
    },
    {
      name: 'Push Press',
      pattern: 'vertical_push', type: 'weighted', sets: 4, reps: 5, weight: 50.0, cooldown: 1,
      notes: 'Use a quick leg dip to drive the bar up',
      description: 'Overhead press with a quick leg push to help get the bar moving. Good for heavier loads.',
      tip: 'The leg push just gets it started — finish the last part of the press with your shoulders and arms.',
    },
    {
      name: 'Machine Shoulder Press',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 12, weight: 40.0, cooldown: 1,
      notes: 'Slow on the way down',
      description: 'Push handles overhead on a machine. More stable than free weights.',
      tip: 'Slow down on the way down — that part builds as much strength as pressing up.',
    },
    {
      name: 'Lateral Raise',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 15, weight: 8.0, cooldown: 1,
      notes: 'Lead with elbows, not hands',
      description: 'Raise dumbbells out to your sides to shoulder height. Builds the width of your shoulders.',
      tip: 'Lead with your elbows, not your hands. Avoid swinging the weight up with your body.',
    },
    {
      name: 'Front Raise',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 12, weight: 8.0, cooldown: 1,
      notes: 'Lift to shoulder height, slight elbow bend',
      description: 'Raise a weight straight in front of you to shoulder height. Hits the front of your shoulders.',
      tip: 'Keep a slight bend in your elbows and do not lean back as you lift.',
    },
    {
      name: 'Cable Lateral Raise',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 15, weight: 10.0, cooldown: 1,
      notes: 'Cable at ankle height, cross body',
      description: 'Like a dumbbell lateral raise but with a cable, which keeps tension through the full movement.',
      tip: 'Stand side-on to the machine with the cable starting at ankle height and crossing your body.',
    },
    {
      name: 'Pike Push-Up',
      pattern: 'vertical_push', type: 'reps_only', sets: 3, reps: 10, weight: null, cooldown: 1,
      notes: 'Hips high, head toward floor',
      description: 'Push-up with hips in the air so your body makes an upside-down V. Shifts work to shoulders.',
      tip: 'Lower your head toward the floor between your hands, then press back up.',
    },
    {
      name: 'Landmine Press',
      pattern: 'vertical_push', type: 'weighted', sets: 3, reps: 10, weight: 30.0, cooldown: 1,
      notes: 'Bar anchored at floor, press at angle',
      description: 'Press one end of a barbell up at an angle. A shoulder-friendly option if pressing straight overhead hurts.',
      tip: 'Stand tall and press it up in a straight line from shoulder height.',
    },

    // ── Vertical Pull ────────────────────────────────────────────────────
    {
      name: 'Pull-Up',
      pattern: 'vertical_pull', type: 'reps_only', sets: 4, reps: 8, weight: null, cooldown: 1,
      notes: 'Start from a full hang every rep',
      description: 'Hang from a bar and pull yourself up until your chin clears it. One of the best upper-body exercises.',
      tip: 'Start from a full hang every rep — arms straight, shoulders relaxed. No cutting the bottom short.',
    },
    {
      name: 'Lat Pulldown',
      pattern: 'vertical_pull', type: 'weighted', sets: 3, reps: 12, weight: 55.0, cooldown: 1,
      notes: 'Wide overhand grip, pull to upper chest',
      description: 'Pull a bar down to your upper chest while seated. The machine version of a pull-up.',
      tip: 'Lean back slightly and pull to your upper chest — do not yank it down past your chin.',
    },
    {
      name: 'Close-Grip Lat Pulldown',
      pattern: 'vertical_pull', type: 'weighted', sets: 3, reps: 12, weight: 50.0, cooldown: 1,
      notes: 'Hands shoulder-width, elbows close',
      description: 'Lat pulldown with hands closer together, which involves the biceps more.',
      tip: 'Keep your elbows pointing straight down as you pull — do not let them flare out to the sides.',
    },
    {
      name: 'Single-Arm Lat Pulldown',
      pattern: 'vertical_pull', type: 'weighted', sets: 3, reps: 12, weight: 25.0, cooldown: 1,
      notes: 'One side at a time',
      description: 'Lat pulldown one arm at a time. Helps fix strength differences between left and right.',
      tip: 'Sit slightly sideways and pull your elbow down toward your hip.',
    },
    {
      name: 'Straight-Arm Pulldown',
      pattern: 'vertical_pull', type: 'weighted', sets: 3, reps: 15, weight: 25.0, cooldown: 1,
      notes: 'Arms stay straight, push bar to hips',
      description: 'Arms stay straight the whole time as you push a cable bar down from overhead to your hips.',
      tip: 'Think of pushing the bar down with your back muscles, not pulling with your arms.',
    },
    {
      name: 'Cable Pull-Over',
      pattern: 'vertical_pull', type: 'weighted', sets: 3, reps: 12, weight: 20.0, cooldown: 1,
      notes: 'Arc from overhead down to hips',
      description: 'Stand at a cable and pull a bar in an arc from overhead all the way down to your hips.',
      tip: 'Arms stay straight — this is about your back doing the work, not your elbows bending.',
    },
    {
      name: 'Chin-Up',
      pattern: 'vertical_pull', type: 'reps_only', sets: 4, reps: 6, weight: null, cooldown: 1,
      notes: 'Palms facing you, full hang to start',
      description: 'Like a pull-up but with palms facing toward you. Easier and involves the biceps more.',
      tip: 'Full hang at the bottom every rep. Pull until your chin is above the bar.',
    },
    {
      name: 'Neutral-Grip Pull-Up',
      pattern: 'vertical_pull', type: 'reps_only', sets: 3, reps: 8, weight: null, cooldown: 1,
      notes: 'Palms facing each other',
      description: 'Pull-up with palms facing each other. Often the most shoulder-friendly grip.',
      tip: 'Full range — start from a dead hang, finish with chin over the bar.',
    },
    {
      name: 'Band-Assisted Pull-Up',
      pattern: 'vertical_pull', type: 'reps_only', sets: 3, reps: 8, weight: null, cooldown: 1,
      notes: 'Band under knees for help',
      description: 'Pull-up with a resistance band looped under your knees to take some weight off.',
      tip: 'Use the band to help you through the hard part, but still pull as hard as you can.',
    },
    {
      name: 'Kneeling Lat Pulldown',
      pattern: 'vertical_pull', type: 'weighted', sets: 3, reps: 12, weight: 40.0, cooldown: 1,
      notes: 'Kneel to prevent leaning back',
      description: 'Lat pulldown while kneeling, which stops you from leaning back to cheat.',
      tip: 'Keep your torso upright and focus on pulling your elbows straight down.',
    },

    // ── Hip Hinge ────────────────────────────────────────────────────────
    {
      name: 'Romanian Deadlift',
      pattern: 'hip_hinge', type: 'weighted', sets: 3, reps: 10, weight: 80.0, cooldown: 1,
      notes: 'Hinge at hips, bar close to legs',
      description: 'Hold a barbell and hinge forward at your hips, lowering the bar toward your shins. Targets the hamstrings.',
      tip: 'Push your hips back like you are trying to close a car door with your backside. Keep the bar close to your legs.',
    },
    {
      name: 'Hip Thrust',
      pattern: 'hip_hinge', type: 'weighted', sets: 3, reps: 12, weight: 80.0, cooldown: 1,
      notes: 'Full hip extension, squeeze at top',
      description: 'Upper back on a bench, barbell across your hips, drive them up. One of the best glute exercises.',
      tip: 'Squeeze hard at the top. Your body from knees to shoulders should form a straight line.',
    },
    {
      name: 'Deadlift',
      pattern: 'hip_hinge', type: 'weighted', sets: 4, reps: 5, weight: 100.0, cooldown: 2,
      notes: 'Drive floor away, chest tall',
      description: 'Pick a barbell up from the floor and stand up straight. Works almost every muscle in your body.',
      tip: 'Drive the floor away — think about pushing down with your legs, not just pulling the bar up.',
    },
    {
      name: 'Sumo Deadlift',
      pattern: 'hip_hinge', type: 'weighted', sets: 4, reps: 5, weight: 100.0, cooldown: 2,
      notes: 'Wide stance, toes out',
      description: 'Deadlift with a wide stance and toes pointed out. More glutes, less strain on the lower back.',
      tip: 'Keep your chest tall and push your knees out over your toes as you pull.',
    },
    {
      name: 'Trap Bar Deadlift',
      pattern: 'hip_hinge', type: 'weighted', sets: 4, reps: 6, weight: 100.0, cooldown: 2,
      notes: 'Stand inside the bar, drive up',
      description: 'Deadlift standing inside a hexagonal bar. Easier on the lower back than a straight bar.',
      tip: 'Stand in the centre of the bar, grab both handles, and drive your legs into the floor.',
    },
    {
      name: 'Single-Leg RDL',
      pattern: 'hip_hinge', type: 'weighted', sets: 3, reps: 10, weight: 20.0, cooldown: 1,
      notes: 'Balance on one leg, hinge forward',
      description: 'Romanian deadlift balanced on one leg. Builds stability and works each side on its own.',
      tip: 'Move slowly — rush it and you will lose your balance. Keep a slight bend in the standing knee.',
    },
    {
      name: 'Good Morning',
      pattern: 'hip_hinge', type: 'weighted', sets: 3, reps: 10, weight: 30.0, cooldown: 1,
      notes: 'Bar on back, bow forward at hips',
      description: 'Bar on your back, hinge forward at the hips until your torso is nearly horizontal, then stand back up.',
      tip: 'This is a hip hinge, not a squat — your knees stay almost straight the whole time.',
    },
    {
      name: 'Glute Bridge',
      pattern: 'hip_hinge', type: 'weighted', sets: 3, reps: 15, weight: 40.0, cooldown: 1,
      notes: 'Feet flat, drive hips to ceiling',
      description: 'Lie on your back, feet flat on the floor, drive your hips up toward the ceiling.',
      tip: 'Squeeze your glutes hard at the top and hold for a second before lowering.',
    },
    {
      name: 'Kettlebell Swing',
      pattern: 'hip_hinge', type: 'weighted', sets: 4, reps: 15, weight: 24.0, cooldown: 1,
      notes: 'Hip snap drives the swing, not arms',
      description: 'Swing a kettlebell from between your legs up to chest height using a sharp hip drive.',
      tip: 'The power comes from snapping your hips forward — your arms are just going along for the ride.',
    },
    {
      name: 'Cable Pull-Through',
      pattern: 'hip_hinge', type: 'weighted', sets: 3, reps: 12, weight: 30.0, cooldown: 1,
      notes: 'Stand away from cable, hinge and drive',
      description: 'Stand facing away from a cable, cable between your legs, hinge and drive your hips forward.',
      tip: 'Let the cable pull your hands back between your legs fully, then drive your hips forward hard.',
    },

    // ── Squat ────────────────────────────────────────────────────────────
    {
      name: 'Squat',
      pattern: 'squat', type: 'weighted', sets: 4, reps: 8, weight: 80.0, cooldown: 1,
      notes: 'Hips below knees, chest up',
      description: 'Bar on your back, squat until your hips go below your knees, then stand. The king of leg exercises.',
      tip: 'Chest up, knees tracking over your toes. Do not let your heels rise off the floor.',
    },
    {
      name: 'Leg Press',
      pattern: 'squat', type: 'weighted', sets: 3, reps: 12, weight: 120.0, cooldown: 1,
      notes: 'Feet shoulder-width, full depth',
      description: 'Push a weighted platform away from you with your legs on a machine. Good for loading up the quads.',
      tip: 'Do not lock your knees fully at the top — keep a slight bend to protect the joint.',
    },
    {
      name: 'Front Squat',
      pattern: 'squat', type: 'weighted', sets: 4, reps: 6, weight: 60.0, cooldown: 1,
      notes: 'Bar on front shoulders, elbows high',
      description: 'Bar resting on the front of your shoulders rather than the back. More upright, more quad-focused.',
      tip: 'Keep your elbows high — if they drop, the bar rolls off your shoulders.',
    },
    {
      name: 'Goblet Squat',
      pattern: 'squat', type: 'weighted', sets: 3, reps: 12, weight: 24.0, cooldown: 1,
      notes: 'Weight at chest, sit tall',
      description: 'Hold a dumbbell or kettlebell at your chest and squat. Great for building good squat technique.',
      tip: 'Sit tall — the weight in front naturally forces your chest up, which is the whole point.',
    },
    {
      name: 'Bulgarian Split Squat',
      pattern: 'squat', type: 'weighted', sets: 3, reps: 10, weight: 20.0, cooldown: 1,
      notes: 'Rear foot on bench, drop straight down',
      description: 'Rear foot elevated on a bench, squat down on the front leg. Tough but very effective.',
      tip: 'Let your back knee drop straight down, not forward. Front shin should stay fairly vertical.',
    },
    {
      name: 'Hack Squat',
      pattern: 'squat', type: 'weighted', sets: 3, reps: 10, weight: 80.0, cooldown: 1,
      notes: 'Machine squat, back supported',
      description: 'Squat on a 45-degree machine with your back supported. Good for isolating the quads.',
      tip: 'Place your feet slightly forward on the platform so your knees do not travel too far over your toes.',
    },
    {
      name: 'Lunges',
      pattern: 'squat', type: 'weighted', sets: 3, reps: 12, weight: 20.0, cooldown: 1,
      notes: 'Step forward, knee over foot',
      description: 'Step forward and drop your back knee toward the floor, then push back up.',
      tip: 'Keep your torso upright — do not lean forward. Front knee tracks over your foot.',
    },
    {
      name: 'Step-Up',
      pattern: 'squat', type: 'weighted', sets: 3, reps: 12, weight: 15.0, cooldown: 1,
      notes: 'Drive through the top leg',
      description: 'Step onto a raised platform, drive through that leg to stand, then step back down.',
      tip: 'Drive through the heel of the top leg — do not push off the bottom foot to cheat.',
    },
    {
      name: 'Box Squat',
      pattern: 'squat', type: 'weighted', sets: 4, reps: 6, weight: 80.0, cooldown: 1,
      notes: 'Sit to box with control, pause, drive up',
      description: 'Squat down to a box, pause briefly, then drive back up. Builds explosive strength.',
      tip: 'Sit back to the box with control — do not plop down. Pause, then drive up hard.',
    },
    {
      name: 'Pistol Squat',
      pattern: 'squat', type: 'reps_only', sets: 3, reps: 5, weight: null, cooldown: 1,
      notes: 'Single leg, full depth',
      description: 'Single-leg squat all the way down while holding the other leg out in front. Very advanced.',
      tip: 'Hold something for balance while learning. Control the descent — do not just drop.',
    },

    // ── Core ─────────────────────────────────────────────────────────────
    {
      name: 'Plank',
      pattern: 'core', type: 'timed', sets: 3, reps: null, weight: null, cooldown: 1,
      notes: 'Hips level, squeeze abs and breathe',
      description: 'Hold a push-up position without moving. Builds the ability to keep your core tight under load.',
      tip: 'Hips level — do not let them sag or pike up. Squeeze your abs and breathe steadily.',
    },
    {
      name: 'Dead Bug',
      pattern: 'core', type: 'timed', sets: 3, reps: null, weight: null, cooldown: 1,
      notes: 'Lower back stays flat on floor',
      description: 'Lie on your back with arms and legs in the air, then slowly lower opposite arm and leg.',
      tip: 'The whole point is keeping your lower back pressed to the floor — if it lifts, you have gone too far.',
    },
    {
      name: 'Ab Rollout',
      pattern: 'core', type: 'reps_only', sets: 3, reps: 8, weight: null, cooldown: 1,
      notes: 'Only go as far as you can stay controlled',
      description: 'Roll a wheel out in front of you, then pull back in using your abs.',
      tip: 'Do not let your lower back collapse as you roll out. Only go as far as you can stay in control.',
    },
    {
      name: 'Cable Crunch',
      pattern: 'core', type: 'weighted', sets: 3, reps: 15, weight: 20.0, cooldown: 1,
      notes: 'Round your spine, elbows to knees',
      description: 'Kneel at a cable and crunch your elbows toward your knees. More resistance than floor crunches.',
      tip: 'Crunch — do not just bow forward. Round your spine and bring your elbows all the way to your knees.',
    },
    {
      name: 'Hanging Leg Raise',
      pattern: 'core', type: 'reps_only', sets: 3, reps: 10, weight: null, cooldown: 1,
      notes: 'Control the swing, legs straight',
      description: 'Hang from a bar and raise your legs up in front of you. Tough lower ab work.',
      tip: 'Control the swing — pull your legs up slowly, do not kick. Lower just as slowly.',
    },
    {
      name: 'Pallof Press',
      pattern: 'core', type: 'timed', sets: 3, reps: null, weight: null, cooldown: 1,
      notes: 'Stand tall, resist rotating',
      description: 'Stand side-on to a cable, press it straight out in front and resist being pulled sideways.',
      tip: 'The challenge is not rotating — stand tall and fight the cable pulling you the whole time.',
    },
    {
      name: 'Hollow Hold',
      pattern: 'core', type: 'timed', sets: 3, reps: null, weight: null, cooldown: 1,
      notes: 'Lower back flat, arms and legs low',
      description: 'Lie on your back, lower back pressed flat, arms and legs held up low to the ground.',
      tip: 'The lower your legs, the harder it is. Keep your lower back glued to the floor throughout.',
    },
    {
      name: 'Russian Twist',
      pattern: 'core', type: 'reps_only', sets: 3, reps: 20, weight: null, cooldown: 1,
      notes: 'Rotate your torso, not just your arms',
      description: 'Sit leaning back at an angle, rotate your torso side to side — with or without a weight.',
      tip: 'Rotate from your torso, not just your arms. Keep your feet off the ground to make it harder.',
    },
    {
      name: 'Bicycle Crunch',
      pattern: 'core', type: 'reps_only', sets: 3, reps: 20, weight: null, cooldown: 1,
      notes: 'Elbow to opposite knee, slow',
      description: 'Crunch up and bring one elbow to the opposite knee while extending the other leg.',
      tip: 'Go slow and actually rotate your torso — do not just move your elbows side to side.',
    },
    {
      name: 'Side Plank',
      pattern: 'core', type: 'timed', sets: 3, reps: null, weight: null, cooldown: 1,
      notes: 'Hip off floor, body straight',
      description: 'Hold a plank on one hand and one foot, body facing sideways. Builds oblique strength.',
      tip: 'Lift your hip — do not let it sag toward the floor. Body in a straight line from head to feet.',
    },

    // ── Carry ────────────────────────────────────────────────────────────
    {
      name: 'Farmer Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 40.0, cooldown: 1,
      notes: 'Walk tall, weights at your sides',
      description: 'Pick up heavy weights and walk. Simple but builds grip strength, core stability, and general toughness.',
      tip: 'Walk tall — do not lean to one side. Short, quick steps and keep your shoulders back.',
    },
    {
      name: 'Suitcase Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 24.0, cooldown: 1,
      notes: 'One hand only, resist the lean',
      description: 'Carry a weight in one hand only, like a heavy suitcase, and walk without leaning to that side.',
      tip: 'The challenge is resisting the sideways pull — stand tall and do not let one shoulder drop.',
    },
    {
      name: 'Yoke Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 80.0, cooldown: 1,
      notes: 'Bar on upper back, short steps',
      description: 'Carry a heavy frame on your upper back and walk. A classic strongman exercise.',
      tip: 'Short steps, stay upright. Let your legs do the work, not your back.',
    },
    {
      name: 'Overhead Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 20.0, cooldown: 1,
      notes: 'Weight locked out overhead',
      description: 'Lock a weight straight overhead and walk. Tough on shoulder stability and core.',
      tip: 'Keep the weight stacked directly above your shoulder — do not let it drift forward.',
    },
    {
      name: 'Trap Bar Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 60.0, cooldown: 1,
      notes: 'Stand inside bar, walk with purpose',
      description: 'Pick up a trap bar and walk with it. Like a farmer carry but with a more natural arm position.',
      tip: 'Stand tall, shoulders back, and focus on controlled steps without swaying side to side.',
    },
    {
      name: 'Sandbag Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 30.0, cooldown: 1,
      notes: 'Hold bag high against chest',
      description: 'Bear-hug a sandbag to your chest and carry it. The awkward shape makes it harder than it looks.',
      tip: 'Hold it high — a low sandbag drags your posture forward and makes it much harder.',
    },
    {
      name: 'Zercher Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 40.0, cooldown: 1,
      notes: 'Bar in crook of elbows',
      description: 'Hold a bar in the crook of your elbows, arms crossed in front, and walk.',
      tip: 'Keep your elbows tight to your body — the bar wants to roll forward if you relax.',
    },
    {
      name: 'Single-Arm Farmer Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 24.0, cooldown: 1,
      notes: 'One arm, resist tilting sideways',
      description: 'Farmer carry with one hand only. Twice as much anti-lean challenge as two-handed.',
      tip: 'Focus on not tilting sideways. Keep the non-carrying side tall, not collapsed.',
    },
    {
      name: 'Bear Hug Carry',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 30.0, cooldown: 1,
      notes: 'Arms around heavy object, chest tall',
      description: 'Wrap your arms around a heavy object and carry it. Great for full-body stability.',
      tip: 'Keep the load close to your body and your chest tall. Let your legs power each step.',
    },
    {
      name: 'Rack Walk',
      pattern: 'carry', type: 'timed', sets: 3, reps: null, weight: 20.0, cooldown: 1,
      notes: 'Weight at shoulder rack position',
      description: 'Hold a weight at shoulder height in the rack position (like a front squat start) and walk.',
      tip: 'Keep your elbow high and the weight close to your body — letting it drop forward makes it much harder.',
    },

    // ── Isolation ────────────────────────────────────────────────────────
    {
      name: 'Bicep Curl',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 12, weight: 15.0, cooldown: 1,
      notes: 'Full range, no swinging',
      description: 'Curl a weight from hip height up to your shoulders. The classic arm exercise.',
      tip: 'Do not swing your body to lift the weight — if you have to, it is too heavy. Full range every rep.',
    },
    {
      name: 'Hammer Curl',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 12, weight: 15.0, cooldown: 1,
      notes: 'Palms facing each other throughout',
      description: 'Bicep curl but with palms facing each other, like holding a hammer. Also works the forearms.',
      tip: 'Slow and controlled — especially on the way down. That is where a lot of the work happens.',
    },
    {
      name: 'Preacher Curl',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 10, weight: 30.0, cooldown: 1,
      notes: 'Upper arm on pad, no swinging',
      description: 'Bicep curl with your upper arm resting on a pad, which removes any chance of swinging.',
      tip: 'Your upper arm stays on the pad the whole time. Control the lowering — do not drop it.',
    },
    {
      name: 'Tricep Pushdown',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 12, weight: 25.0, cooldown: 1,
      notes: 'Elbows at sides, push to full lockout',
      description: 'Push a cable bar down until your arms are straight. Works the back of the upper arm.',
      tip: 'Keep your elbows tucked at your sides — they should not move. Only your forearms move.',
    },
    {
      name: 'Skull Crusher',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 10, weight: 20.0, cooldown: 1,
      notes: 'Bar to forehead, elbows stay vertical',
      description: 'Lie down and lower a bar toward your forehead by bending only at the elbows.',
      tip: 'Only your forearms move — your upper arms stay vertical throughout. Lower slowly.',
    },
    {
      name: 'Overhead Tricep Extension',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 12, weight: 20.0, cooldown: 1,
      notes: 'Elbows forward, lower behind head',
      description: 'Hold a weight overhead and lower it behind your head by bending at the elbows.',
      tip: 'Keep your elbows pointing forward and close together — they tend to flare out as you fatigue.',
    },
    {
      name: 'Leg Curl',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 12, weight: 40.0, cooldown: 1,
      notes: 'Curl heels to glutes, slow return',
      description: 'Lie face-down on a machine and curl your heels up toward your glutes.',
      tip: 'Curl all the way up and squeeze at the top. Lower slowly — do not let it crash back down.',
    },
    {
      name: 'Leg Extension',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 12, weight: 40.0, cooldown: 1,
      notes: 'Extend to lockout, squeeze at top',
      description: 'Sit on a machine and extend your legs straight out in front of you. Isolates the quads.',
      tip: 'Extend fully and hold for a second at the top. Slow, controlled reps — no swinging.',
    },
    {
      name: 'Calf Raise',
      pattern: 'isolation', type: 'weighted', sets: 4, reps: 15, weight: 60.0, cooldown: 1,
      notes: 'Full stretch at bottom, squeeze at top',
      description: 'Rise up onto your toes and lower back down. Builds the calf muscles.',
      tip: 'Full range — lower your heel below the platform on the way down for a proper stretch.',
    },
    {
      name: 'Rear Delt Fly',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 15, weight: 8.0, cooldown: 1,
      notes: 'Slight elbow bend, lift to sides',
      description: 'Bent over or on a machine, raise your arms out to the sides to work the back of your shoulders.',
      tip: 'Lead with your elbows and keep a slight bend in them. These are a small muscle — keep the weight light.',
    },
    {
      name: 'Face Pull',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 15, weight: 20.0, cooldown: 1,
      notes: 'Pull rope to face, elbows flare high',
      description: 'Pull a cable rope to your face with elbows flaring out wide. Keeps your shoulders healthy.',
      tip: 'Pull the rope apart as you bring it to your face. Your elbows should end up above your shoulders.',
    },
    {
      name: 'Shrug',
      pattern: 'isolation', type: 'weighted', sets: 3, reps: 15, weight: 60.0, cooldown: 1,
      notes: 'Pull straight up, no rolling',
      description: 'Hold heavy weights and shrug your shoulders straight up. Works the upper back and neck muscles.',
      tip: 'Pull straight up — do not roll your shoulders. Squeeze at the top and hold for a second.',
    },
  ];

  for (const ex of exercises) {
    await db.runAsync(
      `INSERT OR IGNORE INTO exercises
        (name, movement_pattern, tracking_type, default_sets, default_reps, default_weight,
         cooldown_days, notes, description, form_tip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ex.name, ex.pattern, ex.type, ex.sets,
        ex.reps ?? null, ex.weight ?? null,
        ex.cooldown, ex.notes ?? null,
        ex.description ?? null, ex.tip ?? null,
      ]
    );
  }
}

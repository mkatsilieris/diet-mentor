-- Idempotent schema. Executed on every API start.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  token      TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

-- What the calorie needs are computed from (the weight lives in weigh_ins, because it changes).
CREATE TABLE IF NOT EXISTS profiles (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sex        TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  birth_date DATE NOT NULL,
  height_cm  REAL NOT NULL,
  activity   TEXT NOT NULL CHECK (activity IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One weight per calendar day.
CREATE TABLE IF NOT EXISTS weigh_ins (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  kg      REAL NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- What was eaten and when. "day" is the calendar day of the person, "eaten_time" their wall clock.
CREATE TABLE IF NOT EXISTS food_entries (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  eaten_time TIME NOT NULL,
  name       TEXT NOT NULL,
  kcal       INT NOT NULL CHECK (kcal >= 0),
  -- optional; when every entry of a day has it, the glycogen estimate uses carbs instead of calories
  carbs_g    REAL CHECK (carbs_g >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS food_entries_user_day_idx ON food_entries(user_id, day);

-- Diet sessions: from started_on until ended_on (inclusive); ended_on NULL = running now.
CREATE TABLE IF NOT EXISTS diets (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  started_on      DATE NOT NULL,
  ended_on        DATE,
  planned_days    INT CHECK (planned_days > 0),
  -- the pace asked for; the daily calorie target follows from it
  rate_kg_week    REAL NOT NULL,
  start_weight_kg REAL,
  goal_weight_kg  REAL,
  end_weight_kg   REAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX IF NOT EXISTS diets_user_idx ON diets(user_id, started_on DESC);
-- at most one running diet per person
CREATE UNIQUE INDEX IF NOT EXISTS diets_one_active_idx ON diets(user_id) WHERE ended_on IS NULL;

-- Key/value settings of the installation (the Web Push key pair lives here).
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Browsers / phones that asked for Web Push notifications.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT UNIQUE NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  failures     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

-- What each person wants to be told, and when (wall clock times 'HH:MM' in DISPLAY_TZ).
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id         INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminders       BOOLEAN NOT NULL DEFAULT true,
  reminder_times  TEXT[] NOT NULL,
  motivation      BOOLEAN NOT NULL DEFAULT true,
  motivation_time TEXT NOT NULL,
  weekly          BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every notification, written before it is sent: the key makes sure it goes out once per person.
-- Rows without a title are keys that were taken without sending (not needed, or the baseline).
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT,
  body       TEXT,
  sent       INT NOT NULL DEFAULT 0,
  suppressed TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe)
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

let databaseFactory = null;
let dbInstance = null;

/**
 * Configure the database adapter used by the shared application.
 * The Node server supplies a sqlite3 adapter; Cloudflare Workers supplies D1.
 */
export function setDatabaseFactory(factory) {
  if (typeof factory !== 'function') throw new TypeError('Database factory must be a function');
  databaseFactory = factory;
  dbInstance = null;
}

export async function getDb() {
  if (dbInstance) return dbInstance;
  if (!databaseFactory) throw new Error('Database has not been configured');
  dbInstance = await databaseFactory();
  return dbInstance;
}

export async function initSchema(db) {
  await db.dbExec(`PRAGMA foreign_keys = ON;`);
  await db.dbExec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      bio TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      streak_count INTEGER DEFAULT 0,
      last_active_date TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      participant_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_category ON challenges(category);
    CREATE INDEX IF NOT EXISTS idx_challenges_created_at ON challenges(created_at);
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      vote_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_answers_challenge ON answers(challenge_id);
    CREATE INDEX IF NOT EXISTS idx_answers_user ON answers(user_id);
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(answer_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS replies (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battles (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer_a TEXT NOT NULL,
      answer_b TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      votes_a INTEGER DEFAULT 0,
      votes_b INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS battle_votes (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      choice TEXT NOT NULL CHECK(choice IN ('A','B')),
      created_at TEXT NOT NULL,
      UNIQUE(battle_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      starter TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      status TEXT DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS story_entries (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      vote_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_entries_story ON story_entries(story_id);
    CREATE TABLE IF NOT EXISTS story_votes (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES story_entries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(entry_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS confessions (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      is_hidden INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS xp_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function nowIso(){ return new Date().toISOString(); }

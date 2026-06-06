'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const DB_FILE = 'app.db';
const SCHEMA_VERSION = 1;

let db = null;

function getDataDir() {
  if (app && app.isPackaged) return path.join(path.dirname(app.getPath('exe')), 'data');
  return path.join(__dirname, '..', '..', 'data');
}

function ensureDataDir() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbPath() {
  return path.join(ensureDataDir(), DB_FILE);
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function tableExists(database, tableName) {
  return !!database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName);
}

function assertCompatibleSchema(database) {
  if (tableExists(database, 'schema_meta')) return;
  const existing = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
  ).get();
  if (existing) {
    const error = new Error('A legacy plaintext database was found. Remove data/app.db and restart to create the secure schema.');
    error.code = 'LEGACY_DATABASE';
    throw error;
  }
}

function initializeSchema(database) {
  assertCompatibleSchema(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      username_token BLOB NOT NULL UNIQUE CHECK (typeof(username_token) = 'blob' AND length(username_token) = 32),
      role_token BLOB NOT NULL CHECK (typeof(role_token) = 'blob' AND length(role_token) = 32),
      password_hash TEXT NOT NULL,
      payload_cipher BLOB NOT NULL CHECK (typeof(payload_cipher) = 'blob' AND length(payload_cipher) >= 33),
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_login TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_username_token ON users(username_token);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER NOT NULL,
      login_time TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS opensky_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      snapshot_time INTEGER NOT NULL,
      icao_token BLOB NOT NULL CHECK (typeof(icao_token) = 'blob' AND length(icao_token) = 32),
      has_position_token BLOB NOT NULL CHECK (typeof(has_position_token) = 'blob' AND length(has_position_token) = 32),
      payload_cipher BLOB NOT NULL CHECK (typeof(payload_cipher) = 'blob' AND length(payload_cipher) >= 33),
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(snapshot_time, icao_token)
    );

    CREATE INDEX IF NOT EXISTS idx_opensky_snapshot ON opensky_states(snapshot_time);
    CREATE INDEX IF NOT EXISTS idx_opensky_icao_snapshot ON opensky_states(icao_token, snapshot_time);
    CREATE INDEX IF NOT EXISTS idx_opensky_position ON opensky_states(has_position_token, snapshot_time);

    CREATE TABLE IF NOT EXISTS faa_aircraft (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      mode_s_token BLOB NOT NULL UNIQUE CHECK (typeof(mode_s_token) = 'blob' AND length(mode_s_token) = 32),
      n_number_token BLOB CHECK (n_number_token IS NULL OR (typeof(n_number_token) = 'blob' AND length(n_number_token) = 32)),
      mfr_model_token BLOB CHECK (mfr_model_token IS NULL OR (typeof(mfr_model_token) = 'blob' AND length(mfr_model_token) = 32)),
      payload_cipher BLOB NOT NULL CHECK (typeof(payload_cipher) = 'blob' AND length(payload_cipher) >= 33),
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_faa_mode_s_token ON faa_aircraft(mode_s_token);
    CREATE INDEX IF NOT EXISTS idx_faa_n_number_token ON faa_aircraft(n_number_token);
    CREATE INDEX IF NOT EXISTS idx_faa_mfr_model_token ON faa_aircraft(mfr_model_token);

    CREATE TABLE IF NOT EXISTS secure_dimensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      domain TEXT NOT NULL,
      value_token BLOB NOT NULL CHECK (typeof(value_token) = 'blob' AND length(value_token) = 32),
      display_cipher BLOB NOT NULL CHECK (typeof(display_cipher) = 'blob' AND length(display_cipher) >= 33),
      key_version INTEGER NOT NULL,
      UNIQUE(domain, value_token)
    );

    CREATE INDEX IF NOT EXISTS idx_secure_dimensions_lookup ON secure_dimensions(domain, value_token);

    CREATE TABLE IF NOT EXISTS ntsb_events_secure (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      event_token BLOB NOT NULL UNIQUE CHECK (typeof(event_token) = 'blob' AND length(event_token) = 32),
      payload_cipher BLOB NOT NULL CHECK (typeof(payload_cipher) = 'blob' AND length(payload_cipher) >= 33),
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ntsb_aircraft_secure (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      event_token BLOB NOT NULL CHECK (typeof(event_token) = 'blob' AND length(event_token) = 32),
      aircraft_token BLOB CHECK (aircraft_token IS NULL OR (typeof(aircraft_token) = 'blob' AND length(aircraft_token) = 32)),
      payload_cipher BLOB NOT NULL CHECK (typeof(payload_cipher) = 'blob' AND length(payload_cipher) >= 33),
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ntsb_records_secure (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 32),
      record_token BLOB NOT NULL UNIQUE CHECK (typeof(record_token) = 'blob' AND length(record_token) = 32),
      event_token BLOB NOT NULL CHECK (typeof(event_token) = 'blob' AND length(event_token) = 32),
      aircraft_token BLOB CHECK (aircraft_token IS NULL OR (typeof(aircraft_token) = 'blob' AND length(aircraft_token) = 32)),
      payload_cipher BLOB NOT NULL CHECK (typeof(payload_cipher) = 'blob' AND length(payload_cipher) >= 33),
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ntsb_aircraft_event ON ntsb_aircraft_secure(event_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_aircraft_key ON ntsb_aircraft_secure(aircraft_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_records_event_type ON ntsb_records_secure(event_token, record_type);
    CREATE INDEX IF NOT EXISTS idx_ntsb_records_aircraft ON ntsb_records_secure(aircraft_token);

    CREATE TABLE IF NOT EXISTS ntsb_event_facts (
      event_token BLOB PRIMARY KEY CHECK (typeof(event_token) = 'blob' AND length(event_token) = 32),
      year_token BLOB,
      country_token BLOB,
      state_token BLOB,
      severity_token BLOB,
      light_condition_token BLOB,
      weather_condition_token BLOB,
      visibility_bucket_token BLOB,
      wind_bucket_token BLOB,
      geo_cell_token BLOB,
      has_geo_token BLOB NOT NULL,
      has_narrative_token BLOB NOT NULL,
      fatal_token BLOB NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS ntsb_aircraft_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_token BLOB NOT NULL,
      aircraft_token BLOB,
      category_token BLOB,
      make_token BLOB,
      model_token BLOB,
      damage_token BLOB,
      age_bucket_token BLOB
    );

    CREATE TABLE IF NOT EXISTS ntsb_finding_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_token BLOB NOT NULL,
      record_token BLOB NOT NULL,
      category_token BLOB NOT NULL,
      description_group_token BLOB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ntsb_event_year ON ntsb_event_facts(year_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_event_country ON ntsb_event_facts(country_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_event_state ON ntsb_event_facts(state_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_event_severity ON ntsb_event_facts(severity_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_event_geo ON ntsb_event_facts(geo_cell_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_aircraft_fact_event ON ntsb_aircraft_facts(event_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_aircraft_category ON ntsb_aircraft_facts(category_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_aircraft_make ON ntsb_aircraft_facts(make_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_aircraft_damage ON ntsb_aircraft_facts(damage_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_finding_event ON ntsb_finding_facts(event_token);
    CREATE INDEX IF NOT EXISTS idx_ntsb_finding_category ON ntsb_finding_facts(category_token);

    CREATE TABLE IF NOT EXISTS secure_terms (
      record_type TEXT NOT NULL,
      record_token BLOB NOT NULL CHECK (typeof(record_token) = 'blob' AND length(record_token) = 32),
      term_token BLOB NOT NULL CHECK (typeof(term_token) = 'blob' AND length(term_token) = 32),
      term_count INTEGER NOT NULL DEFAULT 1,
      key_version INTEGER NOT NULL,
      PRIMARY KEY(record_type, record_token, term_token)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_secure_terms_lookup ON secure_terms(record_type, term_token, record_token);

    CREATE TABLE IF NOT EXISTS import_status (
      source_id TEXT PRIMARY KEY,
      record_count INTEGER NOT NULL DEFAULT 0,
      last_download TEXT,
      last_parse TEXT,
      last_import TEXT
    );
  `);

  database.prepare(`
    INSERT INTO schema_meta (id, schema_version, created_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(SCHEMA_VERSION, nowSql());

  const row = database.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get();
  if (!row || row.schema_version !== SCHEMA_VERSION) {
    const error = new Error('The secure database schema version is not supported.');
    error.code = 'SCHEMA_VERSION_UNSUPPORTED';
    throw error;
  }
}

function getDb() {
  if (!db) {
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('trusted_schema = OFF');
    initializeSchema(db);
  }
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  SCHEMA_VERSION,
  getDataDir,
  getDbPath,
  getDb,
  nowSql,
  tableExists,
  closeDatabase,
};

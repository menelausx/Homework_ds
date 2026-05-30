const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const DB_FILE = 'app.db';

let db = null;

function getDataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return path.join(__dirname, '..', '..', 'data');
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getDbPath() {
  return path.join(ensureDataDir(), DB_FILE);
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function getDb() {
  if (!db) {
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  db.exec(`
    -- OpenSky states table
    CREATE TABLE IF NOT EXISTS opensky_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time INTEGER NOT NULL,
      icao24 TEXT NOT NULL,
      callsign TEXT,
      origin_country TEXT,
      time_position INTEGER,
      last_contact INTEGER,
      longitude REAL,
      latitude REAL,
      baro_altitude REAL,
      on_ground INTEGER,
      velocity REAL,
      true_track REAL,
      vertical_rate REAL,
      sensors TEXT,
      geo_altitude REAL,
      squawk TEXT,
      spi INTEGER,
      position_source INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_opensky_states_icao24 ON opensky_states(icao24);
    CREATE INDEX IF NOT EXISTS idx_opensky_states_snapshot ON opensky_states(snapshot_time);
    CREATE INDEX IF NOT EXISTS idx_opensky_states_has_position
      ON opensky_states(longitude, latitude)
      WHERE longitude IS NOT NULL AND latitude IS NOT NULL;

    -- FAA aircraft registry table
    CREATE TABLE IF NOT EXISTS faa_aircraft (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      n_number TEXT,
      serial_number TEXT,
      mfr_mdl_code TEXT,
      eng_mfr_mdl TEXT,
      year_mfr TEXT,
      type_registrant TEXT,
      name TEXT,
      street TEXT,
      street2 TEXT,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      region TEXT,
      county TEXT,
      country TEXT,
      last_action_date TEXT,
      cert_issue_date TEXT,
      certification TEXT,
      type_aircraft TEXT,
      type_engine TEXT,
      status_code TEXT,
      mode_s_code TEXT,
      fract_owner TEXT,
      air_worth_date TEXT,
      expiration_date TEXT,
      unique_id TEXT,
      kit_mfr TEXT,
      kit_model TEXT,
      mode_s_code_hex TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_faa_aircraft_mode_s_code_hex ON faa_aircraft(mode_s_code_hex);
    CREATE INDEX IF NOT EXISTS idx_faa_aircraft_n_number ON faa_aircraft(n_number);
    CREATE INDEX IF NOT EXISTS idx_faa_aircraft_mfr_mdl_code ON faa_aircraft(mfr_mdl_code);
  `);
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, nowSql, closeDatabase };

'use strict';

const openskyService = require('./openskyService');
const cacheService = require('./cacheService');
const databaseService = require('./databaseService');
const keyService = require('./security/keyService');
const cryptoService = require('./security/cryptoService');
const { normalizeIcao } = require('./security/normalizers');

const SOURCE_ID = 'opensky_states';
const RAW_CACHE_FILE = 'opensky_states.securecache';
const HAS_POSITION_DOMAIN = 'index/opensky/has-position/v1';

const sourceId = SOURCE_ID;
const name = 'OpenSky 全量航班状态数据';
const description = '从 OpenSky Network API 获取全球实时航班状态数据。';
const url = 'https://opensky-network.org/api/states/all';

function convertStatesToObjectsAll(rawData) {
  if (!rawData || !Array.isArray(rawData.states)) {
    return { time: rawData && rawData.time ? rawData.time : 0, states: [] };
  }
  return {
    time: rawData.time || 0,
    states: rawData.states.map((state) => ({
      icao24: normalizeIcao(state[0]),
      callsign: String(state[1] || '').trim(),
      origin_country: state[2] || '',
      time_position: state[3] || 0,
      last_contact: state[4] || 0,
      longitude: state[5] == null ? null : state[5],
      latitude: state[6] == null ? null : state[6],
      baro_altitude: state[7] == null ? null : state[7],
      on_ground: state[8] == null ? null : !!state[8],
      velocity: state[9] == null ? null : state[9],
      true_track: state[10] == null ? null : state[10],
      vertical_rate: state[11] == null ? null : state[11],
      sensors: state[12] == null ? null : state[12],
      geo_altitude: state[13] == null ? null : state[13],
      squawk: state[14] == null ? null : String(state[14]),
      spi: state[15] == null ? null : !!state[15],
      position_source: state[16] == null ? null : state[16],
      has_position: state[5] != null && state[6] != null,
    })).filter((state) => state.icao24),
  };
}

function updateStatus(values) {
  const database = databaseService.getDb();
  const current = database.prepare('SELECT * FROM import_status WHERE source_id = ?').get(SOURCE_ID) || {};
  database.prepare(`
    INSERT INTO import_status (source_id, record_count, last_download, last_parse, last_import)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      record_count = excluded.record_count,
      last_download = excluded.last_download,
      last_parse = excluded.last_parse,
      last_import = excluded.last_import
  `).run(
    SOURCE_ID,
    values.recordCount == null ? (current.record_count || 0) : values.recordCount,
    values.lastDownload === undefined ? (current.last_download || null) : values.lastDownload,
    values.lastParse === undefined ? (current.last_parse || null) : values.lastParse,
    values.lastImport === undefined ? (current.last_import || null) : values.lastImport
  );
}

async function download() {
  const rawData = await openskyService.fetchOpenSkyData();
  cacheService.writeJsonFile(RAW_CACHE_FILE, rawData);
  updateStatus({ lastDownload: new Date().toISOString() });
  return { success: true, stateCount: Array.isArray(rawData.states) ? rawData.states.length : 0 };
}

async function parse() {
  const rawData = cacheService.readJsonFile(RAW_CACHE_FILE);
  if (!rawData) throw new Error('OpenSky encrypted cache does not exist. Download it first.');
  const parsed = convertStatesToObjectsAll(rawData);
  updateStatus({ lastParse: new Date().toISOString() });
  return { success: true, recordCount: parsed.states.length, data: parsed };
}

async function importToDatabase(parsedData) {
  const parsed = parsedData || (await parse()).data;
  const db = databaseService.getDb();
  const keyVersion = keyService.getCurrentKeyVersion();
  const now = databaseService.nowSql();
  const insert = db.prepare(`
    INSERT INTO opensky_states (
      record_id, snapshot_time, icao_token, has_position_token,
      payload_cipher, key_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const importAll = db.transaction(() => {
    db.prepare('DELETE FROM opensky_states').run();
    let count = 0;
    for (const state of parsed.states) {
      const recordId = cryptoService.randomRecordId();
      insert.run(
        recordId,
        parsed.time,
        cryptoService.blindIndex(cryptoService.DOMAINS.ICAO_JOIN, normalizeIcao(state.icao24), keyVersion),
        cryptoService.blindIndex(HAS_POSITION_DOMAIN, state.has_position ? '1' : '0', keyVersion),
        cryptoService.encryptJson(
          state,
          { recordType: 'opensky_states', field: 'payload', recordId },
          { keyVersion }
        ),
        keyVersion,
        now
      );
      count++;
    }
    return count;
  });
  const count = importAll();
  updateStatus({ recordCount: count, lastImport: new Date().toISOString() });
  return { success: true, recordCount: count };
}

async function updateAll() {
  const phases = [];
  try {
    phases.push('downloading');
    const downloaded = await download();
    phases.push('parsing');
    const parsed = await parse();
    phases.push('importing');
    const imported = await importToDatabase(parsed.data);
    phases.push('completed');
    return {
      success: true,
      phases,
      downloadCount: downloaded.stateCount,
      parseCount: parsed.recordCount,
      importCount: imported.recordCount,
    };
  } catch (error) {
    phases.push('failed');
    return { success: false, phases, error: error.code || 'OPENSKY_UPDATE_FAILED' };
  }
}

function getStatus() {
  const row = databaseService.getDb().prepare(
    'SELECT record_count, last_download, last_parse, last_import FROM import_status WHERE source_id = ?'
  ).get(SOURCE_ID);
  return {
    recordCount: row ? row.record_count : 0,
    lastDownload: row ? row.last_download : null,
    lastParse: row ? row.last_parse : null,
    lastImport: row ? row.last_import : null,
    error: null,
  };
}

module.exports = {
  sourceId,
  name,
  description,
  url,
  download,
  parse,
  importToDatabase,
  updateAll,
  getStatus,
  convertStatesToObjectsAll,
  getCacheFiles: () => [RAW_CACHE_FILE],
};

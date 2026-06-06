'use strict';

const faaService = require('./faaService');
const cacheService = require('./cacheService');
const databaseService = require('./databaseService');
const keyService = require('./security/keyService');
const cryptoService = require('./security/cryptoService');
const { normalizeIcao, normalizeUpperCode } = require('./security/normalizers');

const SOURCE_ID = 'faa_aircraft';
const CACHE_FILE = 'faa-aircraft.securecache';
const FAA_DOWNLOAD_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip';
const N_NUMBER_DOMAIN = 'index/faa/n-number/v1';
const MFR_MODEL_DOMAIN = 'index/faa/mfr-model/v1';

const sourceId = SOURCE_ID;
const name = 'FAA 注册飞机数据库';
const description = '从 FAA 官网下载美国注册飞机数据。';
const url = FAA_DOWNLOAD_URL;

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
  const buffer = await faaService.downloadBuffer(FAA_DOWNLOAD_URL);
  try {
    cacheService.writeBuffer(CACHE_FILE, SOURCE_ID, buffer);
  } finally {
    buffer.fill(0);
  }
  updateStatus({ lastDownload: new Date().toISOString() });
  return { success: true };
}

async function parse() {
  const zipBuffer = cacheService.readBuffer(CACHE_FILE, SOURCE_ID);
  if (!zipBuffer) throw new Error('FAA encrypted cache does not exist. Download it first.');
  let faaMap;
  try {
    faaMap = faaService.loadFromZipBuffer(zipBuffer);
  } finally {
    zipBuffer.fill(0);
  }
  const records = [...faaMap.values()];
  updateStatus({ lastParse: new Date().toISOString() });
  return { success: true, recordCount: records.length, data: records };
}

async function importToDatabase(parsedData) {
  const records = parsedData || (await parse()).data;
  const db = databaseService.getDb();
  const keyVersion = keyService.getCurrentKeyVersion();
  const now = databaseService.nowSql();
  const insert = db.prepare(`
    INSERT INTO faa_aircraft (
      record_id, mode_s_token, n_number_token, mfr_model_token,
      payload_cipher, key_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const importAll = db.transaction(() => {
    db.prepare('DELETE FROM faa_aircraft').run();
    let count = 0;
    for (const record of records) {
      const modeS = normalizeIcao(record['MODE S CODE HEX']);
      if (!modeS) continue;
      const recordId = cryptoService.randomRecordId();
      insert.run(
        recordId,
        cryptoService.blindIndex(cryptoService.DOMAINS.ICAO_JOIN, modeS, keyVersion),
        record['N-NUMBER']
          ? cryptoService.blindIndex(N_NUMBER_DOMAIN, normalizeUpperCode(record['N-NUMBER']), keyVersion)
          : null,
        record['MFR MDL CODE']
          ? cryptoService.blindIndex(MFR_MODEL_DOMAIN, normalizeUpperCode(record['MFR MDL CODE']), keyVersion)
          : null,
        cryptoService.encryptJson(
          record,
          { recordType: 'faa_aircraft', field: 'payload', recordId },
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
    await download();
    phases.push('parsing');
    const parsed = await parse();
    phases.push('importing');
    const imported = await importToDatabase(parsed.data);
    phases.push('completed');
    return { success: true, phases, parseCount: parsed.recordCount, importCount: imported.recordCount };
  } catch (error) {
    phases.push('failed');
    return { success: false, phases, error: error.code || 'FAA_UPDATE_FAILED' };
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
  getCacheFiles: () => [CACHE_FILE],
};

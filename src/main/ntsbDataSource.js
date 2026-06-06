'use strict';

const AdmZip = require('adm-zip');
const faaService = require('./faaService');
const cacheService = require('./cacheService');
const databaseService = require('./databaseService');
const keyService = require('./security/keyService');
const cryptoService = require('./security/cryptoService');
const dimensionService = require('./security/dimensionService');
const searchIndexService = require('./security/searchIndexService');
const buckets = require('./security/buckets');
const { parseCoordinate, isUsableCoordinatePair } = require('./security/geo');
const {
  normalizeText,
  normalizeUpperCode,
  normalizeInteger,
  normalizeDimension,
} = require('./security/normalizers');

const SOURCE_ID = 'ntsb_aviation_accidents';
const CACHE_FILE = 'ntsb-aviation.securecache';
const MDB_FILENAME = 'avall.mdb';
const NTSB_DOWNLOAD_URL = 'https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.zip';
const TARGET_TABLES = ['events', 'aircraft', 'narratives', 'Findings', 'Flight_Crew', 'engines', 'injury'];

const sourceId = SOURCE_ID;
const name = '美国民航事故调查数据集';
const description = '从 NTSB 下载航空事故调查数据并导入密态事实模型。';
const url = NTSB_DOWNLOAD_URL;

let mdbReaderClass = null;

async function loadMDBReader() {
  if (!mdbReaderClass) mdbReaderClass = (await import('mdb-reader')).default;
  return mdbReaderClass;
}

function field(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    const actual = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
    if (actual) return row[actual];
  }
  return null;
}

function sanitizeValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: value.toString('base64') };
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === 'object') {
    const result = {};
    for (const [key, nested] of Object.entries(value)) result[key] = sanitizeValue(nested);
    return result;
  }
  return value;
}

function getEventYear(row) {
  const direct = Number.parseInt(field(row, 'ev_year'), 10);
  if (Number.isFinite(direct)) return direct;
  const date = field(row, 'ev_date');
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isFinite(parsed.getTime()) ? parsed.getUTCFullYear() : null;
}

function findingCategory(description) {
  const text = normalizeText(description);
  if (/(pilot|personnel|decision|fatigue)/.test(text)) return '人为因素';
  if (/(engine|mechanical|propeller|component)/.test(text)) return '机械/发动机';
  if (/(weather|wind|visibility|icing)/.test(text)) return '天气/环境';
  if (/(approach|landing|runway|flare)/.test(text)) return '进近/着陆';
  if (/(loss of control|stall|spin)/.test(text)) return '失控';
  if (/(maintenance|inspection|repair)/.test(text)) return '维护';
  if (/fuel/.test(text)) return '燃油';
  if (/(communication|atc|clearance)/.test(text)) return '通信/管制';
  if (/(training|instruction)/.test(text)) return '训练';
  return '其他';
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

async function readMdb() {
  const zipBuffer = cacheService.readBuffer(CACHE_FILE, SOURCE_ID);
  if (!zipBuffer) throw new Error('NTSB encrypted cache does not exist. Download it first.');
  try {
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntries().find((item) => item.entryName.toLowerCase() === MDB_FILENAME);
    if (!entry) throw new Error('The NTSB archive does not contain avall.mdb.');
    const MDBReader = await loadMDBReader();
    return new MDBReader(zip.readFile(entry));
  } finally {
    zipBuffer.fill(0);
  }
}

async function download() {
  const buffer = await faaService.downloadBuffer(NTSB_DOWNLOAD_URL);
  try {
    cacheService.writeBuffer(CACHE_FILE, SOURCE_ID, buffer);
  } finally {
    buffer.fill(0);
  }
  updateStatus({ lastDownload: new Date().toISOString() });
  return { success: true };
}

async function parse() {
  const reader = await readMdb();
  const tables = {};
  let recordCount = 0;
  for (const tableName of TARGET_TABLES) {
    const table = reader.getTable(tableName);
    tables[tableName] = { rowCount: table.rowCount };
    recordCount += table.rowCount;
  }
  updateStatus({ lastParse: new Date().toISOString() });
  return { success: true, recordCount, data: { tables } };
}

async function importToDatabase() {
  const reader = await readMdb();
  const db = databaseService.getDb();
  const keyVersion = keyService.getCurrentKeyVersion();
  const now = databaseService.nowSql();
  const dimensionCache = new Map();

  function dim(domain, value, normalizer) {
    const display = value == null || value === '' ? 'UNKNOWN' : value;
    const cacheKey = domain + '\0' + JSON.stringify(display);
    if (!dimensionCache.has(cacheKey)) {
      dimensionCache.set(cacheKey, dimensionService.put(domain, display, {
        db,
        keyVersion,
        normalizer,
      }));
    }
    return dimensionCache.get(cacheKey);
  }

  const eventToken = (value) => cryptoService.blindIndex(
    cryptoService.DOMAINS.NTSB_EVENT,
    normalizeText(value),
    keyVersion
  );
  const aircraftToken = (value) => value == null || value === '' ? null : cryptoService.blindIndex(
    cryptoService.DOMAINS.NTSB_AIRCRAFT,
    normalizeText(value),
    keyVersion
  );
  const narrativeRows = reader.getTable('narratives').getData();
  const narrativeEvents = new Set(narrativeRows.map((row) => normalizeText(field(row, 'ev_id'))).filter(Boolean));
  const eventRows = reader.getTable('events').getData();
  const eventYears = new Map(eventRows.map((row) => [
    normalizeText(field(row, 'ev_id')),
    getEventYear(row),
  ]));

  const insertEventSecure = db.prepare(`
    INSERT INTO ntsb_events_secure (
      record_id, event_token, payload_cipher, key_version, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertEventFact = db.prepare(`
    INSERT INTO ntsb_event_facts (
      event_token, year_token, country_token, state_token, severity_token,
      light_condition_token, weather_condition_token, visibility_bucket_token,
      wind_bucket_token, geo_cell_token, has_geo_token, has_narrative_token, fatal_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAircraftSecure = db.prepare(`
    INSERT INTO ntsb_aircraft_secure (
      record_id, event_token, aircraft_token, payload_cipher, key_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAircraftFact = db.prepare(`
    INSERT INTO ntsb_aircraft_facts (
      event_token, aircraft_token, category_token, make_token,
      model_token, damage_token, age_bucket_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRecord = db.prepare(`
    INSERT INTO ntsb_records_secure (
      record_type, record_id, record_token, event_token, aircraft_token,
      payload_cipher, key_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFindingFact = db.prepare(`
    INSERT INTO ntsb_finding_facts (
      event_token, record_token, category_token, description_group_token
    ) VALUES (?, ?, ?, ?)
  `);
  const insertTerm = db.prepare(`
    INSERT OR IGNORE INTO secure_terms (
      record_type, record_token, term_token, term_count, key_version
    ) VALUES (?, ?, ?, 1, ?)
  `);

  const importAll = db.transaction(() => {
    db.exec(`
      DELETE FROM secure_terms;
      DELETE FROM ntsb_finding_facts;
      DELETE FROM ntsb_aircraft_facts;
      DELETE FROM ntsb_event_facts;
      DELETE FROM ntsb_records_secure;
      DELETE FROM ntsb_aircraft_secure;
      DELETE FROM ntsb_events_secure;
      DELETE FROM secure_dimensions WHERE domain LIKE 'ntsb.%';
    `);
    let count = 0;

    for (const row of eventRows) {
      const eventId = normalizeText(field(row, 'ev_id'));
      if (!eventId) continue;
      const token = eventToken(eventId);
      const recordId = cryptoService.randomRecordId();
      const payload = sanitizeValue(row);
      const year = getEventYear(row);
      const country = normalizeDimension(field(row, 'ev_country'));
      const state = normalizeDimension(field(row, 'ev_state'));
      const severity = normalizeUpperCode(field(row, 'ev_highest_injury')) || 'UNKNOWN';
      const latitude = parseCoordinate(field(row, 'dec_latitude'));
      const longitude = parseCoordinate(field(row, 'dec_longitude'));
      const hasGeo = isUsableCoordinatePair(latitude, longitude);
      const geo = hasGeo ? {
        lat: Math.round(latitude * 2) / 2,
        lng: Math.round(longitude * 2) / 2,
        country,
        state: state === 'UNKNOWN' ? '' : state,
      } : null;
      const hasNarrative = narrativeEvents.has(eventId);
      const fatal = severity === 'FATL';

      insertEventSecure.run(
        recordId,
        token,
        cryptoService.encryptJson(payload, {
          recordType: 'ntsb_events_secure',
          field: 'payload',
          recordId,
        }, { keyVersion }),
        keyVersion,
        now
      );
      insertEventFact.run(
        token,
        year ? dim('ntsb.year', year, normalizeInteger) : null,
        dim('ntsb.country', country),
        dim('ntsb.state', state),
        dim('ntsb.severity', severity, normalizeUpperCode),
        dim('ntsb.light', normalizeDimension(field(row, 'light_cond'))),
        dim('ntsb.weather', normalizeDimension(field(row, 'wx_cond_basic'))),
        dim('ntsb.visibility_bucket', buckets.visibility(field(row, 'vis_sm'))),
        dim('ntsb.wind_bucket', buckets.wind(field(row, 'wind_vel_kts'))),
        geo ? dim('ntsb.geo_cell', geo, (value) => JSON.stringify(value)) : null,
        dim('ntsb.has_geo', hasGeo ? '1' : '0'),
        dim('ntsb.has_narrative', hasNarrative ? '1' : '0'),
        dim('ntsb.fatal', fatal ? '1' : '0')
      );
      count++;
    }

    for (const row of reader.getTable('aircraft').getData()) {
      const eventId = normalizeText(field(row, 'ev_id'));
      if (!eventId) continue;
      const evToken = eventToken(eventId);
      const acToken = aircraftToken(field(row, 'Aircraft_Key'));
      const recordId = cryptoService.randomRecordId();
      const payload = sanitizeValue(row);
      const eventYear = eventYears.get(eventId);
      const aircraftYear = field(row, 'acft_year');
      insertAircraftSecure.run(
        recordId,
        evToken,
        acToken,
        cryptoService.encryptJson(payload, {
          recordType: 'ntsb_aircraft_secure',
          field: 'payload',
          recordId,
        }, { keyVersion }),
        keyVersion,
        now
      );
      insertAircraftFact.run(
        evToken,
        acToken,
        dim('ntsb.aircraft_category', normalizeDimension(field(row, 'acft_category'))),
        dim('ntsb.aircraft_make', normalizeUpperCode(field(row, 'acft_make')) || 'UNKNOWN', normalizeUpperCode),
        dim('ntsb.aircraft_model', normalizeUpperCode(field(row, 'acft_model')) || 'UNKNOWN', normalizeUpperCode),
        dim('ntsb.damage', normalizeDimension(field(row, 'damage'))),
        dim('ntsb.age_bucket', buckets.aircraftAge(eventYear, aircraftYear))
      );
      count++;
    }

    const otherTables = [
      ['narratives', narrativeRows, cryptoService.DOMAINS.TERM_NARRATIVE],
      ['findings', reader.getTable('Findings').getData(), cryptoService.DOMAINS.TERM_FINDING],
      ['flight_crew', reader.getTable('Flight_Crew').getData(), null],
      ['engines', reader.getTable('engines').getData(), null],
      ['injury', reader.getTable('injury').getData(), null],
    ];
    for (const [recordType, rows, termDomain] of otherTables) {
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const eventId = normalizeText(field(row, 'ev_id'));
        if (!eventId) continue;
        const evToken = eventToken(eventId);
        const acToken = aircraftToken(field(row, 'Aircraft_Key'));
        const recordId = cryptoService.randomRecordId();
        const recordToken = cryptoService.blindIndex(
          'index/ntsb/record/' + recordType + '/v1',
          eventId + '|' + normalizeText(field(row, 'Aircraft_Key')) + '|' + index,
          keyVersion
        );
        insertRecord.run(
          recordType,
          recordId,
          recordToken,
          evToken,
          acToken,
          cryptoService.encryptJson(sanitizeValue(row), {
            recordType: 'ntsb_records_secure',
            field: recordType,
            recordId,
          }, { keyVersion }),
          keyVersion,
          now
        );

        let searchableText = '';
        if (recordType === 'narratives') {
          searchableText = [
            field(row, 'narr_accp'), field(row, 'narr_accf'),
            field(row, 'narr_cause'), field(row, 'narr_inc'),
          ].filter(Boolean).join(' ');
        } else if (recordType === 'findings') {
          searchableText = field(row, 'finding_description') || '';
          const description = normalizeDimension(searchableText);
          insertFindingFact.run(
            evToken,
            recordToken,
            dim('ntsb.finding_category', findingCategory(description)),
            dim('ntsb.finding_description', description)
          );
        }
        if (termDomain && searchableText) {
          for (const token of searchIndexService.termTokens(searchableText, termDomain, keyVersion)) {
            insertTerm.run(recordType, recordToken, token, keyVersion);
          }
        }
        count++;
      }
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
    const imported = await importToDatabase();
    phases.push('completed');
    return { success: true, phases, parseCount: parsed.recordCount, importCount: imported.recordCount };
  } catch (error) {
    phases.push('failed');
    return { success: false, phases, error: error.code || 'NTSB_UPDATE_FAILED' };
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
  findingCategory,
  getCacheFiles: () => [CACHE_FILE],
};

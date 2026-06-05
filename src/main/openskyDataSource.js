const fs = require('fs');
const path = require('path');
const openskyService = require('./openskyService');
const cacheService = require('./cacheService');
const databaseService = require('./databaseService');

const SOURCE_ID = 'opensky_states';
const RAW_CACHE_FILE = 'opensky_states_raw.json';

// ── Helpers ────────────────────────────────────────────────────────────────

function convertStatesToObjectsAll(rawData) {
  // Convert ALL states including those without lat/lon
  // Each state lacking lat/lon gets a has_position flag set to false
  if (!rawData || !rawData.states || !Array.isArray(rawData.states)) {
    return { time: rawData && rawData.time ? rawData.time : 0, states: [] };
  }

  const states = rawData.states.map((state) => ({
    icao24: (state[0] || '').toLowerCase().trim(),
    callsign: (state[1] || '').trim(),
    origin_country: state[2] || '',
    time_position: state[3] || 0,
    last_contact: state[4] || 0,
    longitude: state[5] != null ? state[5] : null,
    latitude: state[6] != null ? state[6] : null,
    baro_altitude: state[7] != null ? state[7] : null,
    on_ground: state[8] != null ? (state[8] ? 1 : 0) : null,
    velocity: state[9] != null ? state[9] : null,
    true_track: state[10] != null ? state[10] : null,
    vertical_rate: state[11] != null ? state[11] : null,
    sensors: state[12] != null ? String(state[12]) : null,
    geo_altitude: state[13] != null ? state[13] : null,
    squawk: state[14] != null ? String(state[14]) : null,
    spi: state[15] != null ? (state[15] ? 1 : 0) : null,
    position_source: state[16] != null ? state[16] : null,
    has_position: state[5] != null && state[6] != null,
  }));

  return {
    time: rawData.time || 0,
    states,
  };
}

// ── Data Source Interface ──────────────────────────────────────────────────

const sourceId = SOURCE_ID;
const name = 'OpenSky 全量航班状态数据';
const description = '从 OpenSky Network API 获取全球实时航班状态数据，包含位置、速度、高度等信息。';
const url = 'https://opensky-network.org/api/states/all';

async function download() {
  const rawData = await openskyService.fetchOpenSkyData();
  const cachePath = cacheService.getDataFilePath(RAW_CACHE_FILE);
  // Ensure parent directory exists
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify(rawData, null, 2), 'utf8');
  console.log('[OpenSkyDataSource] Downloaded ' + (rawData.states ? rawData.states.length : 0) + ' states to ' + cachePath);
  return { success: true, stateCount: rawData.states ? rawData.states.length : 0, filePath: cachePath };
}

async function parse() {
  const cachePath = cacheService.getDataFilePath(RAW_CACHE_FILE);
  if (!fs.existsSync(cachePath)) {
    throw new Error('原始数据缓存不存在，请先下载。');
  }

  const rawContent = fs.readFileSync(cachePath, 'utf8');
  const rawData = JSON.parse(rawContent);
  const parsed = convertStatesToObjectsAll(rawData);

  console.log('[OpenSkyDataSource] Parsed ' + parsed.states.length + ' states (including ' +
    parsed.states.filter(function (s) { return !s.has_position; }).length + ' without position)');

  return { success: true, recordCount: parsed.states.length, data: parsed };
}

async function importToDatabase(parsedData) {
  let parseResult;
  if (parsedData) {
    parseResult = { success: true, recordCount: parsedData.states.length, data: parsedData };
  } else {
    parseResult = await parse();
  }
  const states = parseResult.data.states;
  const snapshotTime = parseResult.data.time;

  const db = databaseService.getDb();
  const now = databaseService.nowSql();

  const insertStmt = db.prepare(`
    INSERT INTO opensky_states (
      snapshot_time, icao24, callsign, origin_country, time_position, last_contact,
      longitude, latitude, baro_altitude, on_ground, velocity, true_track,
      vertical_rate, sensors, geo_altitude, squawk, spi, position_source,
      created_at
    ) VALUES (
      @snapshot_time, @icao24, @callsign, @origin_country, @time_position, @last_contact,
      @longitude, @latitude, @baro_altitude, @on_ground, @velocity, @true_track,
      @vertical_rate, @sensors, @geo_altitude, @squawk, @spi, @position_source,
      @created_at
    )
  `);

  const clearAll = db.prepare('DELETE FROM opensky_states');

  const importAll = db.transaction(function () {
    clearAll.run();

    let count = 0;
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      insertStmt.run({
        snapshot_time: snapshotTime,
        icao24: s.icao24,
        callsign: s.callsign || null,
        origin_country: s.origin_country || null,
        time_position: s.time_position || null,
        last_contact: s.last_contact || null,
        longitude: s.longitude,
        latitude: s.latitude,
        baro_altitude: s.baro_altitude,
        on_ground: s.on_ground,
        velocity: s.velocity,
        true_track: s.true_track,
        vertical_rate: s.vertical_rate,
        sensors: s.sensors,
        geo_altitude: s.geo_altitude,
        squawk: s.squawk,
        spi: s.spi,
        position_source: s.position_source,
        created_at: now,
      });
      count++;
    }
    return count;
  });

  const count = importAll();
  console.log('[OpenSkyDataSource] Imported ' + count + ' records into opensky_states');
  return { success: true, recordCount: count };
}

async function updateAll() {
  const phases = [];
  try {
    phases.push('downloading');
    const dlResult = await download();
    phases.push('parsing');
    const parseResult = await parse();
    phases.push('importing');
    const importResult = await importToDatabase(parseResult.data);
    phases.push('completed');
    return {
      success: true,
      phases,
      downloadCount: dlResult.stateCount,
      parseCount: parseResult.recordCount,
      importCount: importResult.recordCount,
    };
  } catch (err) {
    phases.push('failed');
    return { success: false, phases, error: err.message };
  }
}

function getStatus() {
  const db = databaseService.getDb();
  const recordCount = db.prepare('SELECT COUNT(*) AS count FROM opensky_states').get().count || 0;

  const rawCachePath = cacheService.getDataFilePath(RAW_CACHE_FILE);
  const lastDownload = fs.existsSync(rawCachePath)
    ? fs.statSync(rawCachePath).mtime.toISOString()
    : null;

  // lastParse and lastImport: approximate from the most recent created_at in the table
  const lastRecord = db.prepare(
    'SELECT created_at FROM opensky_states ORDER BY id DESC LIMIT 1'
  ).get();
  const lastImport = lastRecord ? lastRecord.created_at : null;

  return {
    recordCount,
    lastDownload,
    lastParse: lastImport, // approximate — parse happens before import
    lastImport,
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
};

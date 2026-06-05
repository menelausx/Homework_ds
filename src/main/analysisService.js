// SQLite-backed analysis service.
// All data for the FAA/OpenSky analysis page comes from the database.
// This service never accesses external APIs, files, or network.

const databaseService = require('./databaseService');

// ── Flight Queries ─────────────────────────────────────────────────────────

function getLatestSnapshotTime() {
  const db = databaseService.getDb();
  const row = db.prepare('SELECT MAX(snapshot_time) AS snapshot_time FROM opensky_states').get();
  return row ? row.snapshot_time : null;
}

function getFlights() {
  const db = databaseService.getDb();
  const snapshotTime = getLatestSnapshotTime();
  if (snapshotTime === null) {
    return { time: 0, cacheTime: null, states: [], snapshotTime: null };
  }

  const rows = db.prepare(`
    SELECT
      icao24, callsign, origin_country, time_position, last_contact,
      longitude, latitude, baro_altitude, on_ground, velocity, true_track,
      vertical_rate, sensors, geo_altitude, squawk, spi, position_source
    FROM opensky_states
    WHERE snapshot_time = ?
    ORDER BY icao24
  `).all(snapshotTime);

  const states = rows.map(function (row) {
    return {
      icao24: row.icao24,
      callsign: row.callsign || '',
      origin_country: row.origin_country || '',
      time_position: row.time_position || 0,
      last_contact: row.last_contact || 0,
      longitude: row.longitude,
      latitude: row.latitude,
      baro_altitude: row.baro_altitude,
      on_ground: row.on_ground === 1,
      velocity: row.velocity,
      true_track: row.true_track,
      vertical_rate: row.vertical_rate,
      sensors: row.sensors,
      geo_altitude: row.geo_altitude,
      squawk: row.squawk,
      spi: row.spi,
      position_source: row.position_source,
    };
  });

  return {
    time: snapshotTime,
    cacheTime: snapshotTime ? new Date(snapshotTime * 1000).toISOString() : null,
    states: states,
    snapshotTime: snapshotTime,
  };
}

function getFlight(icao24) {
  if (!icao24) return null;
  const db = databaseService.getDb();
  const key = icao24.toLowerCase().trim();
  const snapshotTime = getLatestSnapshotTime();
  if (snapshotTime === null) return null;

  const row = db.prepare(`
    SELECT * FROM opensky_states
    WHERE icao24 = ? AND snapshot_time = ?
    LIMIT 1
  `).get(key, snapshotTime);

  if (!row) return null;

  return {
    icao24: row.icao24,
    callsign: row.callsign || '',
    origin_country: row.origin_country || '',
    time_position: row.time_position,
    last_contact: row.last_contact,
    longitude: row.longitude,
    latitude: row.latitude,
    baro_altitude: row.baro_altitude,
    on_ground: row.on_ground === 1,
    velocity: row.velocity,
    true_track: row.true_track,
    vertical_rate: row.vertical_rate,
    sensors: row.sensors,
    geo_altitude: row.geo_altitude,
    squawk: row.squawk,
    spi: row.spi === 1,
    position_source: row.position_source,
  };
}

// ── FAA Aircraft Queries ───────────────────────────────────────────────────

function getFaaInfo(icao24) {
  if (!icao24) return null;
  const db = databaseService.getDb();
  const key = icao24.toLowerCase().trim();

  const row = db.prepare(`
    SELECT * FROM faa_aircraft
    WHERE mode_s_code_hex = ?
    LIMIT 1
  `).get(key);

  if (!row) return null;

  // Map column names to the format expected by the renderer (FAA CSV headers)
  return {
    'N-NUMBER': row.n_number,
    'SERIAL NUMBER': row.serial_number,
    'MFR MDL CODE': row.mfr_mdl_code,
    'ENG MFR MDL': row.eng_mfr_mdl,
    'YEAR MFR': row.year_mfr,
    'TYPE REGISTRANT': row.type_registrant,
    'NAME': row.name,
    'STREET': row.street,
    'STREET2': row.street2,
    'CITY': row.city,
    'STATE': row.state,
    'ZIP CODE': row.zip_code,
    'REGION': row.region,
    'COUNTY': row.county,
    'COUNTRY': row.country,
    'LAST ACTION DATE': row.last_action_date,
    'CERT ISSUE DATE': row.cert_issue_date,
    'CERTIFICATION': row.certification,
    'TYPE AIRCRAFT': row.type_aircraft,
    'TYPE ENGINE': row.type_engine,
    'STATUS CODE': row.status_code,
    'MODE S CODE': row.mode_s_code,
    'FRACT OWNER': row.fract_owner,
    'AIR WORTH DATE': row.air_worth_date,
    'EXPIRATION DATE': row.expiration_date,
    'UNIQUE ID': row.unique_id,
    'KIT MFR': row.kit_mfr,
    'KIT MODEL': row.kit_model,
    'MODE S CODE HEX': row.mode_s_code_hex,
    '_id': row.id,
  };
}

function getFaaInfoBulk(icao24List) {
  if (!icao24List || !Array.isArray(icao24List) || icao24List.length === 0) {
    return {};
  }

  // Build keys (lowercase)
  var keys = [];
  for (var i = 0; i < icao24List.length; i++) {
    if (icao24List[i]) {
      keys.push(icao24List[i].toLowerCase().trim());
    }
  }
  if (keys.length === 0) return {};

  // SQLite max variable number is 999 by default; chunk at 500
  var result = {};
  var CHUNK = 500;
  for (var offset = 0; offset < keys.length; offset += CHUNK) {
    var chunk = keys.slice(offset, offset + CHUNK);
    var placeholders = chunk.map(function () { return '?'; }).join(', ');

    var db = databaseService.getDb();
    var stmt = db.prepare(
      'SELECT * FROM faa_aircraft WHERE mode_s_code_hex IN (' + placeholders + ')'
    );
    var rows = stmt.all.apply(stmt, chunk);

    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      result[row.mode_s_code_hex] = {
        'N-NUMBER': row.n_number,
        'SERIAL NUMBER': row.serial_number,
        'MFR MDL CODE': row.mfr_mdl_code,
        'ENG MFR MDL': row.eng_mfr_mdl,
        'YEAR MFR': row.year_mfr,
        'TYPE REGISTRANT': row.type_registrant,
        'NAME': row.name,
        'STREET': row.street,
        'STREET2': row.street2,
        'CITY': row.city,
        'STATE': row.state,
        'ZIP CODE': row.zip_code,
        'REGION': row.region,
        'COUNTY': row.county,
        'COUNTRY': row.country,
        'LAST ACTION DATE': row.last_action_date,
        'CERT ISSUE DATE': row.cert_issue_date,
        'CERTIFICATION': row.certification,
        'TYPE AIRCRAFT': row.type_aircraft,
        'TYPE ENGINE': row.type_engine,
        'STATUS CODE': row.status_code,
        'MODE S CODE': row.mode_s_code,
        'FRACT OWNER': row.fract_owner,
        'AIR WORTH DATE': row.air_worth_date,
        'EXPIRATION DATE': row.expiration_date,
        'UNIQUE ID': row.unique_id,
        'KIT MFR': row.kit_mfr,
        'KIT MODEL': row.kit_model,
        'MODE S CODE HEX': row.mode_s_code_hex,
        '_id': row.id,
      };
    }
  }

  return result;
}

// ── Statistics ─────────────────────────────────────────────────────────────

function getStatistics() {
  var db = databaseService.getDb();

  var flightCount = db.prepare(
    'SELECT COUNT(DISTINCT icao24) AS count FROM opensky_states WHERE snapshot_time = (SELECT MAX(snapshot_time) FROM opensky_states)'
  ).get().count || 0;

  var snapshotTime = getLatestSnapshotTime();

  var faaTotalRecords = db.prepare('SELECT COUNT(*) AS count FROM faa_aircraft').get().count || 0;

  // Count flights with FAA match (icao24 present in faa_aircraft.mode_s_code_hex)
  var faaMatched = 0;
  if (snapshotTime !== null) {
    faaMatched = db.prepare(`
      SELECT COUNT(DISTINCT o.icao24) AS count
      FROM opensky_states o
      INNER JOIN faa_aircraft f ON o.icao24 = f.mode_s_code_hex
      WHERE o.snapshot_time = ?
    `).get(snapshotTime).count || 0;
  }

  return {
    flightCount: flightCount,
    faaMatched: faaMatched,
    faaTotalRecords: faaTotalRecords,
    faaLoaded: faaTotalRecords > 0,
    faaError: null,
    snapshotTime: snapshotTime,
  };
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  getFlights,
  getFlight,
  getFaaInfo,
  getFaaInfoBulk,
  getStatistics,
  getLatestSnapshotTime,
};

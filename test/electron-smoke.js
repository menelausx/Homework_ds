'use strict';

const { app } = require('electron');
const keyService = require('../src/main/security/keyService');
const cryptoService = require('../src/main/security/cryptoService');
const dimensionService = require('../src/main/security/dimensionService');
const databaseService = require('../src/main/databaseService');
const userService = require('../src/main/userService');
const openskyDataSource = require('../src/main/openskyDataSource');
const faaDataSource = require('../src/main/faaDataSource');
const analysisService = require('../src/main/analysisService');
const ntsbAnalysisService = require('../src/main/ntsbAnalysisService');

app.setPath('userData', path.join(databaseService.getDataDir(), 'electron-profile'));
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');
app.commandLine.appendSwitch('disable-gpu');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(async () => {
  try {
    console.log('[smoke] ready');
    const security = keyService.initialize({
      dataDir: databaseService.getDataDir(),
      bootstrap: { userId: 1, password: 'admin123' },
    });
    if (security.created) userService.seedDefaultAdmin();
    keyService.lock();
    keyService.unlock('admin123');
    console.log('[smoke] keyring unlocked');
    const db = databaseService.getDb();
    const schema = db.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get();
    assert(schema.schema_version === 1, 'schema version mismatch');

    const forbiddenColumns = new Set([
      'username', 'role', 'icao24', 'callsign', 'origin_country',
      'mode_s_code_hex', 'name', 'street', 'city', 'ev_id',
      'dec_latitude', 'dec_longitude', 'finding_description',
    ]);
    for (const table of ['users', 'opensky_states', 'faa_aircraft', 'ntsb_events_secure']) {
      const columns = db.prepare('PRAGMA table_info("' + table + '")').all();
      assert(!columns.some((column) => forbiddenColumns.has(column.name)), 'plaintext column in ' + table);
    }

    userService.seedDefaultAdmin();
    const login = userService.verifyLogin('ADMIN', 'admin123');
    assert(login && login.username === 'admin', 'encrypted user login failed');
    console.log('[smoke] user verified');
    const usernamePlan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT id FROM users WHERE username_token = ?'
    ).all(cryptoService.blindIndex(cryptoService.DOMAINS.USERNAME, 'admin'));
    assert(usernamePlan.some((row) => /INDEX/i.test(row.detail)), 'username index not used');

    await openskyDataSource.importToDatabase({
      time: 1700000000,
      states: [{
        icao24: 'abc123',
        callsign: 'SECURE1',
        origin_country: 'Test Country',
        time_position: 1700000000,
        last_contact: 1700000000,
        longitude: 10.5,
        latitude: 20.5,
        baro_altitude: 1000,
        on_ground: false,
        velocity: 200,
        true_track: 90,
        vertical_rate: 0,
        sensors: null,
        geo_altitude: 1100,
        squawk: '1234',
        spi: false,
        position_source: 0,
        has_position: true,
      }],
    });
    await faaDataSource.importToDatabase([{
      'MODE S CODE HEX': 'ABC123',
      'N-NUMBER': 'N12345',
      'NAME': 'Sensitive Owner',
      'STREET': 'Sensitive Street',
    }]);
    const flight = analysisService.getFlight('ABC123');
    const faa = analysisService.getFaaInfo('abc123');
    const statistics = analysisService.getStatistics();
    assert(flight && flight.callsign === 'SECURE1', 'OpenSky decrypt failed');
    assert(faa && faa.NAME === 'Sensitive Owner', 'FAA decrypt failed');
    assert(statistics.faaMatched === 1, 'blind-index join failed');
    console.log('[smoke] FAA/OpenSky verified');
    const joinPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT o.id
      FROM opensky_states o
      INNER JOIN faa_aircraft f ON f.mode_s_token = o.icao_token
      WHERE o.snapshot_time = ?
    `).all(1700000000);
    assert(joinPlan.some((row) => /INDEX/i.test(row.detail)), 'aircraft join index not used');

    const eventToken = cryptoService.blindIndex(cryptoService.DOMAINS.NTSB_EVENT, 'event-smoke');
    const year = dimensionService.put('ntsb.year', 2024, { db, normalizer: (value) => String(value) });
    const country = dimensionService.put('ntsb.country', 'US', { db });
    const state = dimensionService.put('ntsb.state', 'CA', { db });
    const severity = dimensionService.put('ntsb.severity', 'FATL', { db, normalizer: (value) => String(value).toUpperCase() });
    const light = dimensionService.put('ntsb.light', 'DAY', { db });
    const weather = dimensionService.put('ntsb.weather', 'VMC', { db });
    const visibility = dimensionService.put('ntsb.visibility_bucket', '10+', { db });
    const wind = dimensionService.put('ntsb.wind_bucket', '<5', { db });
    const geo = dimensionService.put('ntsb.geo_cell', { lat: 1, lng: 2, country: 'US', state: 'CA' }, {
      db,
      normalizer: JSON.stringify,
    });
    const yesGeo = dimensionService.put('ntsb.has_geo', '1', { db });
    const yesNarrative = dimensionService.put('ntsb.has_narrative', '1', { db });
    const fatal = dimensionService.put('ntsb.fatal', '1', { db });
    db.prepare(`
      INSERT INTO ntsb_event_facts (
        event_token, year_token, country_token, state_token, severity_token,
        light_condition_token, weather_condition_token, visibility_bucket_token,
        wind_bucket_token, geo_cell_token, has_geo_token, has_narrative_token, fatal_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(eventToken, year, country, state, severity, light, weather, visibility, wind, geo, yesGeo, yesNarrative, fatal);
    const overview = ntsbAnalysisService.getOverview({ yearFrom: 2024, yearTo: 2024, country: 'US' });
    assert(overview.totalEvents === 1 && overview.fatalEvents === 1, 'NTSB token aggregation failed');
    assert(ntsbAnalysisService.getGeoAggregation({}).length === 1, 'NTSB geo dictionary resolution failed');
    console.log('[smoke] NTSB verified');

    const ciphertextLeak = db.prepare(`
      SELECT
        instr(CAST(payload_cipher AS TEXT), 'Sensitive Owner') AS ownerLeak,
        instr(CAST(payload_cipher AS TEXT), 'Sensitive Street') AS streetLeak
      FROM faa_aircraft LIMIT 1
    `).get();
    assert(ciphertextLeak.ownerLeak === 0 && ciphertextLeak.streetLeak === 0, 'plaintext found in ciphertext');

    db.exec(`
      DELETE FROM ntsb_event_facts;
      DELETE FROM secure_dimensions WHERE domain LIKE 'ntsb.%';
      DELETE FROM opensky_states;
      DELETE FROM faa_aircraft;
      DELETE FROM import_status WHERE source_id IN ('opensky_states', 'faa_aircraft');
    `);
    console.log(JSON.stringify({
      success: true,
      schemaVersion: schema.schema_version,
      usernameIndex: usernamePlan.map((row) => row.detail),
      aircraftJoinPlan: joinPlan.map((row) => row.detail),
    }));
    databaseService.closeDatabase();
    keyService.lock();
    keyService.clear();
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ success: false, code: error.code || 'SMOKE_FAILED', message: error.message }));
    databaseService.closeDatabase();
    keyService.lock();
    keyService.clear();
    app.exit(1);
  }
});

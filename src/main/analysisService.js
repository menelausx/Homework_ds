'use strict';

const databaseService = require('./databaseService');
const cryptoService = require('./security/cryptoService');
const { normalizeIcao } = require('./security/normalizers');

const MAX_BULK_ICAO = 2000;
const QUERY_CHUNK = 400;

function decryptPayload(row, recordType) {
  return cryptoService.decryptJson(row.payload_cipher, {
    recordType,
    field: 'payload',
    recordId: row.record_id,
  });
}

function getLatestSnapshotTime() {
  const row = databaseService.getDb()
    .prepare('SELECT MAX(snapshot_time) AS snapshot_time FROM opensky_states')
    .get();
  return row ? row.snapshot_time : null;
}

function getFlights() {
  const snapshotTime = getLatestSnapshotTime();
  if (snapshotTime == null) return { time: 0, cacheTime: null, states: [], snapshotTime: null };
  const rows = databaseService.getDb().prepare(`
    SELECT record_id, payload_cipher
    FROM opensky_states
    WHERE snapshot_time = ?
  `).all(snapshotTime);
  const states = rows.map((row) => decryptPayload(row, 'opensky_states'));
  states.sort((left, right) => left.icao24.localeCompare(right.icao24));
  return {
    time: snapshotTime,
    cacheTime: new Date(snapshotTime * 1000).toISOString(),
    states,
    snapshotTime,
  };
}

function getFlight(icao24) {
  const normalized = normalizeIcao(icao24);
  if (!normalized || normalized.length > 32) return null;
  const snapshotTime = getLatestSnapshotTime();
  if (snapshotTime == null) return null;
  const token = cryptoService.blindIndex(cryptoService.DOMAINS.ICAO_JOIN, normalized);
  const row = databaseService.getDb().prepare(`
    SELECT record_id, payload_cipher
    FROM opensky_states
    WHERE icao_token = ? AND snapshot_time = ?
    LIMIT 1
  `).get(token, snapshotTime);
  return row ? decryptPayload(row, 'opensky_states') : null;
}

function getFaaInfo(icao24) {
  const normalized = normalizeIcao(icao24);
  if (!normalized || normalized.length > 32) return null;
  const token = cryptoService.blindIndex(cryptoService.DOMAINS.ICAO_JOIN, normalized);
  const row = databaseService.getDb().prepare(`
    SELECT id, record_id, payload_cipher
    FROM faa_aircraft
    WHERE mode_s_token = ?
    LIMIT 1
  `).get(token);
  if (!row) return null;
  return { ...decryptPayload(row, 'faa_aircraft'), _id: row.id };
}

function getFaaInfoBulk(icao24List) {
  if (!Array.isArray(icao24List) || icao24List.length === 0) return {};
  const normalized = [...new Set(icao24List.slice(0, MAX_BULK_ICAO)
    .map(normalizeIcao)
    .filter((value) => value && value.length <= 32))];
  const result = {};
  const db = databaseService.getDb();

  for (let offset = 0; offset < normalized.length; offset += QUERY_CHUNK) {
    const values = normalized.slice(offset, offset + QUERY_CHUNK);
    const tokens = values.map((value) => cryptoService.blindIndex(cryptoService.DOMAINS.ICAO_JOIN, value));
    const placeholders = tokens.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT id, record_id, payload_cipher
      FROM faa_aircraft
      WHERE mode_s_token IN (${placeholders})
    `).all(...tokens);
    for (const row of rows) {
      const payload = decryptPayload(row, 'faa_aircraft');
      const key = normalizeIcao(payload['MODE S CODE HEX']);
      if (key) result[key] = { ...payload, _id: row.id };
    }
  }
  return result;
}

function getStatistics() {
  const db = databaseService.getDb();
  const snapshotTime = getLatestSnapshotTime();
  const flightCount = snapshotTime == null ? 0 : db.prepare(`
    SELECT COUNT(DISTINCT icao_token) AS count
    FROM opensky_states
    WHERE snapshot_time = ?
  `).get(snapshotTime).count;
  const faaTotalRecords = db.prepare('SELECT COUNT(*) AS count FROM faa_aircraft').get().count;
  const faaMatched = snapshotTime == null ? 0 : db.prepare(`
    SELECT COUNT(DISTINCT o.icao_token) AS count
    FROM opensky_states o
    INNER JOIN faa_aircraft f ON f.mode_s_token = o.icao_token
    WHERE o.snapshot_time = ?
  `).get(snapshotTime).count;
  return {
    flightCount,
    faaMatched,
    faaTotalRecords,
    faaLoaded: faaTotalRecords > 0,
    faaError: null,
    snapshotTime,
  };
}

module.exports = {
  getFlights,
  getFlight,
  getFaaInfo,
  getFaaInfoBulk,
  getStatistics,
  getLatestSnapshotTime,
};

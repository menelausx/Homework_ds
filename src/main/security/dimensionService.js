'use strict';

const databaseService = require('../databaseService');
const keyService = require('./keyService');
const cryptoService = require('./cryptoService');
const { normalizeDimension } = require('./normalizers');

function indexDomain(domain) {
  return 'index/dimension/' + domain + '/v1';
}

function tokenFor(domain, value, normalizer, keyVersion) {
  const normalize = normalizer || normalizeDimension;
  return cryptoService.blindIndex(indexDomain(domain), normalize(value), keyVersion);
}

function put(domain, value, options) {
  const db = (options && options.db) || databaseService.getDb();
  const keyVersion = (options && options.keyVersion) || keyService.getCurrentKeyVersion();
  const normalizer = options && options.normalizer;
  const token = tokenFor(domain, value, normalizer, keyVersion);
  if (!token) return null;
  const existing = db.prepare(
    'SELECT value_token FROM secure_dimensions WHERE domain = ? AND value_token = ?'
  ).get(domain, token);
  if (!existing) {
    const recordId = cryptoService.randomRecordId();
    db.prepare(`
      INSERT INTO secure_dimensions (
        record_id, domain, value_token, display_cipher, key_version
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      recordId,
      domain,
      token,
      cryptoService.encryptJson(
        value,
        { recordType: 'secure_dimensions', field: 'display', recordId },
        { keyVersion }
      ),
      keyVersion
    );
  }
  return token;
}

function get(domain, token, db) {
  if (!token) return null;
  const row = (db || databaseService.getDb()).prepare(`
    SELECT record_id, display_cipher
    FROM secure_dimensions
    WHERE domain = ? AND value_token = ?
  `).get(domain, token);
  return row ? cryptoService.decryptJson(row.display_cipher, {
    recordType: 'secure_dimensions',
    field: 'display',
    recordId: row.record_id,
  }) : null;
}

function getMany(domain, tokens, db) {
  const database = db || databaseService.getDb();
  const unique = [];
  const seen = new Set();
  for (const token of tokens || []) {
    if (!token) continue;
    const key = Buffer.from(token).toString('hex');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(token);
    }
  }
  if (unique.length === 0) return new Map();

  const result = new Map();
  const chunkSize = 400;
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = database.prepare(`
      SELECT value_token, record_id, display_cipher
      FROM secure_dimensions
      WHERE domain = ? AND value_token IN (${placeholders})
    `).all(domain, ...chunk);
    for (const row of rows) {
      result.set(
        Buffer.from(row.value_token).toString('hex'),
        cryptoService.decryptJson(row.display_cipher, {
          recordType: 'secure_dimensions',
          field: 'display',
          recordId: row.record_id,
        })
      );
    }
  }
  return result;
}

function resolveRows(domain, rows, tokenField, outputField, db) {
  const values = getMany(domain, rows.map((row) => row[tokenField]), db);
  return rows.map((row) => {
    const token = row[tokenField];
    return {
      ...row,
      [outputField]: token ? values.get(Buffer.from(token).toString('hex')) : null,
    };
  });
}

module.exports = { indexDomain, tokenFor, put, get, getMany, resolveRows };

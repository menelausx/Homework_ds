'use strict';

const crypto = require('crypto');
const keyService = require('./keyService');

const ENVELOPE_FORMAT = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + 4 + NONCE_BYTES + TAG_BYTES;

const DOMAINS = Object.freeze({
  DATA: 'encryption/data/v1',
  USERNAME: 'index/user/username/v1',
  ROLE: 'index/user/role/v1',
  ICAO_JOIN: 'index/aircraft/icao-mode-s/v1',
  NTSB_EVENT: 'index/ntsb/event-id/v1',
  NTSB_AIRCRAFT: 'index/ntsb/aircraft-key/v1',
  TERM_NARRATIVE: 'index/ntsb/term/narrative/v1',
  TERM_FINDING: 'index/ntsb/term/finding/v1',
  CACHE: 'encryption/cache/v1',
});

function aadBuffer(context) {
  if (!context || !context.recordType || !context.field || !context.recordId) {
    throw new TypeError('AAD context requires recordType, field, and recordId');
  }
  return Buffer.from(JSON.stringify({
    envelopeVersion: ENVELOPE_FORMAT,
    recordType: String(context.recordType),
    field: String(context.field),
    recordId: String(context.recordId),
  }), 'utf8');
}

function encryptBuffer(plaintext, context, options) {
  const keyVersion = Number(options && options.keyVersion) || keyService.getCurrentKeyVersion();
  const domain = (options && options.domain) || DOMAINS.DATA;
  const key = keyService.deriveKey(domain, keyVersion);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadBuffer(context));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.alloc(5);
  header.writeUInt8(ENVELOPE_FORMAT, 0);
  header.writeUInt32BE(keyVersion, 1);
  return Buffer.concat([header, nonce, tag, ciphertext]);
}

function decryptBuffer(envelope, context, options) {
  const input = Buffer.from(envelope);
  if (input.length < HEADER_BYTES || input.readUInt8(0) !== ENVELOPE_FORMAT) {
    const error = new Error('Encrypted payload format is invalid.');
    error.code = 'CIPHERTEXT_INVALID';
    throw error;
  }
  const keyVersion = input.readUInt32BE(1);
  const domain = (options && options.domain) || DOMAINS.DATA;
  const key = keyService.deriveKey(domain, keyVersion);
  const nonce = input.subarray(5, 5 + NONCE_BYTES);
  const tag = input.subarray(5 + NONCE_BYTES, HEADER_BYTES);
  const ciphertext = input.subarray(HEADER_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadBuffer(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (_error) {
    const error = new Error('Encrypted payload authentication failed.');
    error.code = 'CIPHERTEXT_AUTH_FAILED';
    throw error;
  }
}

function encryptJson(value, context, options) {
  return encryptBuffer(Buffer.from(JSON.stringify(value), 'utf8'), context, options);
}

function decryptJson(envelope, context, options) {
  const plaintext = decryptBuffer(envelope, context, options);
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } finally {
    plaintext.fill(0);
  }
}

function blindIndex(domain, normalizedValue, keyVersion) {
  if (!domain || !normalizedValue) return null;
  const version = Number(keyVersion) || keyService.getCurrentKeyVersion();
  return crypto
    .createHmac('sha256', keyService.deriveKey(domain, version))
    .update(String(normalizedValue), 'utf8')
    .digest();
}

function timingSafeTokenEqual(left, right) {
  const a = Buffer.from(left || []);
  const b = Buffer.from(right || []);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomRecordId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  DOMAINS,
  ENVELOPE_FORMAT,
  encryptBuffer,
  decryptBuffer,
  encryptJson,
  decryptJson,
  blindIndex,
  timingSafeTokenEqual,
  randomRecordId,
};

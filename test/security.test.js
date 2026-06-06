'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const keyService = require('../src/main/security/keyService');
const cryptoService = require('../src/main/security/cryptoService');
const secureCacheService = require('../src/main/security/secureCacheService');
const normalizers = require('../src/main/security/normalizers');
const searchIndexService = require('../src/main/security/searchIndexService');
const buckets = require('../src/main/security/buckets');
const geo = require('../src/main/security/geo');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-search-test-'));
keyService.initialize({
  dataDir: testDir,
  bootstrap: { userId: 1, password: 'bootstrap-password' },
});

test.after(() => {
  keyService.clear();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('normalizers are deterministic and Unicode aware', () => {
  assert.equal(normalizers.normalizeUsername('  Ａlice\tSmith  '), 'alice smith');
  assert.equal(normalizers.normalizeIcao(' A0Bc12 '), 'a0bc12');
  assert.equal(normalizers.normalizeUpperCode(' ca '), 'CA');
});

test('AES-GCM uses unique nonces and binds AAD', () => {
  const context = { recordType: 'test', field: 'payload', recordId: 'record-1' };
  const first = cryptoService.encryptJson({ secret: 'value' }, context);
  const second = cryptoService.encryptJson({ secret: 'value' }, context);
  assert.notDeepEqual(first, second);
  assert.deepEqual(cryptoService.decryptJson(first, context), { secret: 'value' });
  assert.throws(
    () => cryptoService.decryptJson(first, { ...context, recordId: 'record-2' }),
    (error) => error.code === 'CIPHERTEXT_AUTH_FAILED'
  );
});

test('AES-GCM rejects modified ciphertext', () => {
  const context = { recordType: 'test', field: 'payload', recordId: 'record-3' };
  const encrypted = cryptoService.encryptJson({ secret: 'value' }, context);
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(
    () => cryptoService.decryptJson(encrypted, context),
    (error) => error.code === 'CIPHERTEXT_AUTH_FAILED'
  );
});

test('blind indexes are stable within a domain and isolated across domains', () => {
  const first = cryptoService.blindIndex('index/test/a/v1', 'same-value');
  const second = cryptoService.blindIndex('index/test/a/v1', 'same-value');
  const otherDomain = cryptoService.blindIndex('index/test/b/v1', 'same-value');
  assert.ok(cryptoService.timingSafeTokenEqual(first, second));
  assert.equal(first.length, 32);
  assert.notDeepEqual(first, otherDomain);
});

test('old ciphertext remains decryptable after key rotation', () => {
  const context = { recordType: 'test', field: 'payload', recordId: 'record-4' };
  const oldVersion = keyService.getCurrentKeyVersion();
  const encrypted = cryptoService.encryptJson({ version: oldVersion }, context);
  const newVersion = keyService.rotateMasterKey();
  assert.ok(newVersion > oldVersion);
  assert.deepEqual(cryptoService.decryptJson(encrypted, context), { version: oldVersion });
});

test('portable keyring locks and unlocks with user passwords', () => {
  keyService.addUserSlot(2, 'second-user-password');
  keyService.lock();
  assert.equal(keyService.isUnlocked(), false);
  assert.throws(
    () => keyService.unlock('wrong-password'),
    (error) => error.code === 'UNLOCK_FAILED'
  );
  keyService.unlock('second-user-password');
  assert.equal(keyService.isUnlocked(), true);
});

test('chunked cache detects tampering and truncation', () => {
  const plaintext = Buffer.from('0123456789'.repeat(100));
  const encrypted = secureCacheService.encryptCacheBuffer(plaintext, 'cache-test', { chunkSize: 64 });
  assert.deepEqual(secureCacheService.decryptCacheBuffer(encrypted, 'cache-test'), plaintext);

  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(
    () => secureCacheService.decryptCacheBuffer(tampered, 'cache-test'),
    (error) => error.code === 'CACHE_AUTH_FAILED'
  );
  assert.throws(
    () => secureCacheService.decryptCacheBuffer(encrypted.subarray(0, encrypted.length - 8), 'cache-test'),
    (error) => error.code === 'CACHE_AUTH_FAILED'
  );

  const headerTampered = Buffer.from(encrypted);
  const marker = headerTampered.indexOf(Buffer.from('"chunkSize":64'));
  assert.ok(marker > 0);
  headerTampered[marker + '"chunkSize":'.length] = '7'.charCodeAt(0);
  assert.throws(
    () => secureCacheService.decryptCacheBuffer(headerTampered, 'cache-test'),
    (error) => error.code === 'CACHE_AUTH_FAILED'
  );
});

test('chunked cache detects block reordering', () => {
  const plaintext = Buffer.from('abcdefgh'.repeat(100));
  const encrypted = secureCacheService.encryptCacheBuffer(plaintext, 'reorder-test', { chunkSize: 80 });
  const headerLength = encrypted.readUInt32BE(8);
  let offset = 12 + headerLength + 28;
  const chunks = [];
  while (offset < encrypted.length) {
    const length = encrypted.readUInt32BE(offset);
    const totalLength = 4 + 12 + 16 + length;
    chunks.push(encrypted.subarray(offset, offset + totalLength));
    offset += totalLength;
  }
  const reordered = Buffer.concat([
    encrypted.subarray(0, 12 + headerLength + 28),
    chunks[1],
    chunks[0],
    ...chunks.slice(2),
  ]);
  assert.throws(
    () => secureCacheService.decryptCacheBuffer(reordered, 'reorder-test'),
    (error) => error.code === 'CACHE_AUTH_FAILED'
  );
});

test('tokenization and range buckets are centralized', () => {
  assert.deepEqual(
    searchIndexService.tokenize('The PILOT, pilot made a forced-landing.'),
    ['pilot', 'made', 'forced-landing']
  );
  assert.equal(buckets.aircraftAge(2020, 2005), '10-19');
  assert.equal(buckets.visibility(2.5), '1-3');
  assert.equal(buckets.wind(25), '25-34');
});

test('missing and zero-zero coordinates are rejected', () => {
  assert.equal(geo.parseCoordinate(null), null);
  assert.equal(geo.parseCoordinate(''), null);
  assert.equal(geo.parseCoordinate('  '), null);
  assert.equal(geo.isUsableCoordinatePair(0, 0), false);
  assert.equal(geo.isUsableCoordinatePair(0, 120), true);
  assert.equal(geo.isUsableCoordinatePair(30, 0), true);
  assert.equal(geo.isUsableCoordinatePair(91, 10), false);
});

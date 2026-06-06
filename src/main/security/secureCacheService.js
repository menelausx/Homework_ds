'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const keyService = require('./keyService');

const MAGIC = Buffer.from('DSCACHE1', 'ascii');
const DEFAULT_CHUNK_SIZE = 1024 * 1024;

function chunkAad(header, chunkIndex) {
  return Buffer.from(JSON.stringify({
    formatVersion: header.formatVersion,
    cacheId: header.cacheId,
    keyVersion: header.keyVersion,
    chunkSize: header.chunkSize,
    chunkCount: header.chunkCount,
    plaintextLength: header.plaintextLength,
    chunkIndex,
  }), 'utf8');
}

function encryptCacheBuffer(input, cacheId, options) {
  const data = Buffer.from(input);
  const keyVersion = keyService.getCurrentKeyVersion();
  const key = keyService.deriveKey('encryption/cache/v1', keyVersion);
  const chunkSize = (options && options.chunkSize) || DEFAULT_CHUNK_SIZE;
  const chunkCount = Math.ceil(data.length / chunkSize);
  const header = Buffer.from(JSON.stringify({
    formatVersion: 1,
    keyVersion,
    chunkSize,
    chunkCount,
    plaintextLength: data.length,
    cacheId,
  }), 'utf8');
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32BE(header.length);
  const headerNonce = crypto.randomBytes(12);
  const headerCipher = crypto.createCipheriv('aes-256-gcm', key, headerNonce);
  headerCipher.setAAD(Buffer.concat([MAGIC, headerLength, header]));
  headerCipher.final();
  const parts = [MAGIC, headerLength, header, headerNonce, headerCipher.getAuthTag()];

  for (let index = 0; index < chunkCount; index++) {
    const nonce = crypto.randomBytes(12);
    const plaintext = data.subarray(index * chunkSize, Math.min(data.length, (index + 1) * chunkSize));
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(chunkAad(JSON.parse(header.toString('utf8')), index));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(ciphertext.length);
    parts.push(length, nonce, tag, ciphertext);
  }
  return Buffer.concat(parts);
}

function decryptCacheBuffer(input, expectedCacheId) {
  const data = Buffer.from(input);
  if (data.length < 12 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw Object.assign(new Error('Encrypted cache format is invalid.'), { code: 'CACHE_INVALID' });
  }
  let offset = MAGIC.length;
  const headerLength = data.readUInt32BE(offset);
  offset += 4;
  let header;
  try {
    header = JSON.parse(data.subarray(offset, offset + headerLength).toString('utf8'));
  } catch (_error) {
    throw Object.assign(new Error('Encrypted cache header is invalid.'), { code: 'CACHE_INVALID' });
  }
  offset += headerLength;
  if (header.formatVersion !== 1 || header.cacheId !== expectedCacheId) {
    throw Object.assign(new Error('Encrypted cache identity is invalid.'), { code: 'CACHE_INVALID' });
  }
  const key = keyService.deriveKey('encryption/cache/v1', header.keyVersion);
  if (offset + 28 > data.length) {
    throw Object.assign(new Error('Encrypted cache header is truncated.'), { code: 'CACHE_AUTH_FAILED' });
  }
  const headerNonce = data.subarray(offset, offset + 12);
  offset += 12;
  const headerTag = data.subarray(offset, offset + 16);
  offset += 16;
  try {
    const headerDecipher = crypto.createDecipheriv('aes-256-gcm', key, headerNonce);
    const encodedHeaderLength = Buffer.alloc(4);
    encodedHeaderLength.writeUInt32BE(headerLength);
    headerDecipher.setAAD(Buffer.concat([
      MAGIC,
      encodedHeaderLength,
      data.subarray(MAGIC.length + 4, MAGIC.length + 4 + headerLength),
    ]));
    headerDecipher.setAuthTag(headerTag);
    headerDecipher.final();
  } catch (_error) {
    throw Object.assign(new Error('Encrypted cache header authentication failed.'), { code: 'CACHE_AUTH_FAILED' });
  }
  const chunks = [];

  try {
    for (let index = 0; index < header.chunkCount; index++) {
      if (offset + 32 > data.length) throw new Error('truncated');
      const cipherLength = data.readUInt32BE(offset);
      offset += 4;
      const nonce = data.subarray(offset, offset + 12);
      offset += 12;
      const tag = data.subarray(offset, offset + 16);
      offset += 16;
      if (offset + cipherLength > data.length) throw new Error('truncated');
      const ciphertext = data.subarray(offset, offset + cipherLength);
      offset += cipherLength;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(chunkAad(header, index));
      decipher.setAuthTag(tag);
      chunks.push(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
    }
    if (offset !== data.length) throw new Error('trailing data');
    const plaintext = Buffer.concat(chunks);
    if (plaintext.length !== header.plaintextLength) throw new Error('length mismatch');
    return plaintext;
  } catch (_error) {
    for (const chunk of chunks) chunk.fill(0);
    throw Object.assign(new Error('Encrypted cache authentication failed.'), { code: 'CACHE_AUTH_FAILED' });
  }
}

function writeEncryptedFile(filePath, cacheId, input) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const encrypted = encryptCacheBuffer(input, cacheId);
  const temporary = filePath + '.tmp-' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readEncryptedFile(filePath, cacheId) {
  return decryptCacheBuffer(fs.readFileSync(filePath), cacheId);
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  encryptCacheBuffer,
  decryptCacheBuffer,
  writeEncryptedFile,
  readEncryptedFile,
};

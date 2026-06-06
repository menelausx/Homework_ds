'use strict';

const fs = require('fs');
const path = require('path');
const databaseService = require('./databaseService');
const secureCacheService = require('./security/secureCacheService');

function getDataDir() {
  return databaseService.getDataDir();
}

function ensureDataDir() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDataFilePath(filename) {
  return path.join(ensureDataDir(), filename);
}

function fileExistsInData(filename) {
  return fs.existsSync(getDataFilePath(filename));
}

function writeBuffer(filename, cacheId, data) {
  secureCacheService.writeEncryptedFile(getDataFilePath(filename), cacheId, data);
}

function readBuffer(filename, cacheId) {
  const filePath = getDataFilePath(filename);
  if (!fs.existsSync(filePath)) return null;
  return secureCacheService.readEncryptedFile(filePath, cacheId);
}

function writeJsonFile(filename, data) {
  writeBuffer(filename, filename, Buffer.from(JSON.stringify(data), 'utf8'));
}

function readJsonFile(filename) {
  const plaintext = readBuffer(filename, filename);
  if (!plaintext) return null;
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } finally {
    plaintext.fill(0);
  }
}

function cleanRawDataCache() {
  const dir = ensureDataDir();
  const protectedNames = new Set([
    'app.db',
    'app.db-wal',
    'app.db-shm',
    'keyring.json',
    'electron-profile',
  ]);
  const deleted = [];
  const skipped = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (protectedNames.has(entry.name.toLowerCase())) {
      skipped.push({ path: entry.name, reason: 'protected' });
      continue;
    }
    const target = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
      deleted.push(entry.name);
    } catch (_error) {
      skipped.push({ path: entry.name, error: 'CACHE_DELETE_FAILED' });
    }
  }

  return {
    success: true,
    deleted,
    skipped,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  };
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  readBuffer,
  writeBuffer,
  fileExistsInData,
  getDataFilePath,
  cleanRawDataCache,
  ensureDataDir,
};

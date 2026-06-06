'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const databaseService = require('../databaseService');
const keyService = require('./keyService');

const FORMAT_VERSION = 1;
const FILE_NAME = 'login-session.json';

function getSessionPath() {
  return path.join(databaseService.getDataDir(), FILE_NAME);
}

function readSession() {
  const value = JSON.parse(fs.readFileSync(getSessionPath(), 'utf8'));
  if (
    !value
    || value.formatVersion !== FORMAT_VERSION
    || !Number.isSafeInteger(value.userId)
    || typeof value.slotId !== 'string'
    || !/^[a-f0-9]{32}$/.test(value.slotId)
    || typeof value.token !== 'string'
    || value.token.length < 40
  ) {
    throw new Error('Invalid saved login session');
  }
  return value;
}

function atomicWrite(value) {
  const target = getSessionPath();
  const temporary = target + '.tmp-' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function create(userId) {
  clear();
  const token = crypto.randomBytes(32).toString('base64url');
  const slotId = keyService.createSessionSlot(userId, token);
  try {
    atomicWrite({
      formatVersion: FORMAT_VERSION,
      userId: Number(userId),
      slotId,
      token,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    keyService.revokeSessionSlot(slotId);
    throw error;
  }
}

function restore() {
  const session = readSession();
  keyService.unlockSession(session.slotId, session.userId, session.token);
  return session.userId;
}

function clear() {
  let session = null;
  try {
    session = readSession();
  } catch (_error) {
    // Missing or malformed files are removed below.
  }
  if (session && keyService.isUnlocked()) {
    keyService.revokeSessionSlot(session.slotId);
  }
  discard();
}

function discard() {
  try {
    fs.unlinkSync(getSessionPath());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function exists() {
  return fs.existsSync(getSessionPath());
}

module.exports = { create, restore, clear, discard, exists };

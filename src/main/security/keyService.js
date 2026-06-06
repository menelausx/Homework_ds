'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYRING_FORMAT = 2;
const KEY_BYTES = 32;
const KDF = Object.freeze({
  name: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 32,
});

let state = null;

function controlledError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function atomicWriteJson(filePath, value) {
  const temporary = filePath + '.tmp-' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function aad(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function seal(key, plaintext, associatedData) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(associatedData));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function open(key, envelope, associatedData) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.nonce, 'base64')
  );
  decipher.setAAD(aad(associatedData));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

function deriveUnlockKey(password, salt) {
  if (typeof password !== 'string' || !password.length) {
    throw controlledError('UNLOCK_FAILED', 'The login password could not unlock the encrypted data.');
  }
  return crypto.scryptSync(password, salt, KDF.keyLength, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 64 * 1024 * 1024,
  });
}

function slotAad(slot) {
  return {
    formatVersion: KEYRING_FORMAT,
    purpose: 'user-unlock-slot',
    slotId: slot.slotId,
    userId: slot.userId,
  };
}

function masterAad(keyVersion) {
  return {
    formatVersion: KEYRING_FORMAT,
    purpose: 'wrapped-master-key',
    keyVersion,
  };
}

function makeUnlockSlot(rootKey, userId, password) {
  const salt = crypto.randomBytes(16);
  const unlockKey = deriveUnlockKey(password, salt);
  const slot = {
    slotId: crypto.randomBytes(16).toString('hex'),
    userId: Number(userId),
    salt: salt.toString('base64'),
    createdAt: new Date().toISOString(),
  };
  try {
    slot.wrappedRootKey = seal(unlockKey, rootKey, slotAad(slot));
    return slot;
  } finally {
    unlockKey.fill(0);
  }
}

function validateKeyring(keyring) {
  if (
    !keyring
    || keyring.formatVersion !== KEYRING_FORMAT
    || keyring.kdf.name !== KDF.name
    || !Array.isArray(keyring.unlockSlots)
    || !Array.isArray(keyring.wrappedMasterKeys)
    || !Number.isSafeInteger(keyring.currentKeyVersion)
  ) {
    throw controlledError('KEYRING_INVALID', 'The portable keyring format is invalid or unsupported.');
  }
}

function initialize(options) {
  if (state) return { created: false, unlocked: isUnlocked() };
  const dataDir = options && options.dataDir;
  if (!dataDir) throw new TypeError('dataDir is required');
  fs.mkdirSync(dataDir, { recursive: true });
  const keyringPath = path.join(dataDir, 'keyring.json');

  if (fs.existsSync(keyringPath)) {
    let keyring;
    try {
      keyring = JSON.parse(fs.readFileSync(keyringPath, 'utf8'));
    } catch (_error) {
      throw controlledError('KEYRING_INVALID', 'The portable keyring file is not valid JSON.');
    }
    validateKeyring(keyring);
    state = { keyringPath, keyring, rootKey: null, keys: new Map() };
    return { created: false, unlocked: false };
  }

  const bootstrap = options && options.bootstrap;
  if (!bootstrap || !bootstrap.password || !Number.isSafeInteger(Number(bootstrap.userId))) {
    throw controlledError('KEYRING_BOOTSTRAP_REQUIRED', 'A bootstrap login is required to create the portable keyring.');
  }
  const rootKey = crypto.randomBytes(KEY_BYTES);
  const masterKey = crypto.randomBytes(KEY_BYTES);
  const keyring = {
    formatVersion: KEYRING_FORMAT,
    currentKeyVersion: 1,
    createdAt: new Date().toISOString(),
    kdf: KDF,
    unlockSlots: [makeUnlockSlot(rootKey, Number(bootstrap.userId), bootstrap.password)],
    wrappedMasterKeys: [{
      keyVersion: 1,
      wrappedMasterKey: seal(rootKey, masterKey, masterAad(1)),
      createdAt: new Date().toISOString(),
    }],
  };
  atomicWriteJson(keyringPath, keyring);
  state = {
    keyringPath,
    keyring,
    rootKey,
    keys: new Map([[1, masterKey]]),
  };
  return { created: true, unlocked: true };
}

function assertInitialized() {
  if (!state) throw controlledError('SECURITY_NOT_INITIALIZED', 'Security services have not been initialized.');
}

function isUnlocked() {
  return !!(state && state.rootKey && state.keys.size);
}

function assertUnlocked() {
  assertInitialized();
  if (!isUnlocked()) throw controlledError('DATA_LOCKED', 'Login is required to unlock encrypted data.');
}

function unlock(password) {
  assertInitialized();
  if (isUnlocked()) return { success: true };

  for (const slot of state.keyring.unlockSlots) {
    let unlockKey;
    let rootKey;
    try {
      unlockKey = deriveUnlockKey(password, Buffer.from(slot.salt, 'base64'));
      rootKey = open(unlockKey, slot.wrappedRootKey, slotAad(slot));
      if (rootKey.length !== KEY_BYTES) throw new Error('invalid root key');
      const keys = new Map();
      for (const entry of state.keyring.wrappedMasterKeys) {
        const masterKey = open(rootKey, entry.wrappedMasterKey, masterAad(entry.keyVersion));
        if (masterKey.length !== KEY_BYTES) throw new Error('invalid master key');
        keys.set(entry.keyVersion, masterKey);
      }
      state.rootKey = rootKey;
      state.keys = keys;
      return { success: true, userId: slot.userId };
    } catch (_error) {
      if (rootKey) rootKey.fill(0);
    } finally {
      if (unlockKey) unlockKey.fill(0);
    }
  }
  throw controlledError('UNLOCK_FAILED', 'The login password could not unlock the encrypted data.');
}

function lock() {
  if (!state) return;
  if (state.rootKey) state.rootKey.fill(0);
  for (const key of state.keys.values()) key.fill(0);
  state.rootKey = null;
  state.keys = new Map();
}

function getCurrentKeyVersion() {
  assertUnlocked();
  return state.keyring.currentKeyVersion;
}

function getMasterKey(keyVersion) {
  assertUnlocked();
  const key = state.keys.get(Number(keyVersion));
  if (!key) throw controlledError('KEY_VERSION_UNKNOWN', 'The requested encryption key version is unavailable.');
  return key;
}

function deriveKey(domain, keyVersion) {
  if (!domain || typeof domain !== 'string') throw new TypeError('domain is required');
  const version = Number(keyVersion || getCurrentKeyVersion());
  const salt = Buffer.from('data-security-app/hkdf-salt/v1', 'utf8');
  const info = Buffer.from('data-security-app/' + domain + '/key-v' + version, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', getMasterKey(version), salt, info, KEY_BYTES));
}

function writeKeyring(next) {
  atomicWriteJson(state.keyringPath, next);
  state.keyring = next;
}

function stageUserSlot(userId, password) {
  assertUnlocked();
  const slot = makeUnlockSlot(state.rootKey, Number(userId), password);
  writeKeyring({ ...state.keyring, unlockSlots: state.keyring.unlockSlots.concat([slot]) });
  return slot.slotId;
}

function commitUserSlot(userId, slotId) {
  assertUnlocked();
  const nextSlots = state.keyring.unlockSlots.filter(
    (slot) => slot.userId !== Number(userId) || slot.slotId === slotId
  );
  if (!nextSlots.some((slot) => slot.slotId === slotId)) {
    throw controlledError('KEYRING_SLOT_MISSING', 'The staged user unlock slot is missing.');
  }
  writeKeyring({ ...state.keyring, unlockSlots: nextSlots });
}

function rollbackUserSlot(slotId) {
  assertUnlocked();
  writeKeyring({
    ...state.keyring,
    unlockSlots: state.keyring.unlockSlots.filter((slot) => slot.slotId !== slotId),
  });
}

function addUserSlot(userId, password) {
  const slotId = stageUserSlot(userId, password);
  commitUserSlot(userId, slotId);
}

function removeUserSlot(userId) {
  assertUnlocked();
  const nextSlots = state.keyring.unlockSlots.filter((slot) => slot.userId !== Number(userId));
  if (nextSlots.length === 0) {
    throw controlledError('LAST_UNLOCK_SLOT', 'At least one login must remain able to unlock the data.');
  }
  writeKeyring({ ...state.keyring, unlockSlots: nextSlots });
}

function rotateMasterKey() {
  assertUnlocked();
  const nextVersion = Math.max(...state.keyring.wrappedMasterKeys.map((entry) => entry.keyVersion)) + 1;
  const masterKey = crypto.randomBytes(KEY_BYTES);
  const next = {
    ...state.keyring,
    currentKeyVersion: nextVersion,
    wrappedMasterKeys: state.keyring.wrappedMasterKeys.concat([{
      keyVersion: nextVersion,
      wrappedMasterKey: seal(state.rootKey, masterKey, masterAad(nextVersion)),
      createdAt: new Date().toISOString(),
    }]),
  };
  writeKeyring(next);
  state.keys.set(nextVersion, masterKey);
  return nextVersion;
}

function clear() {
  lock();
  state = null;
}

module.exports = {
  initialize,
  unlock,
  lock,
  isUnlocked,
  getCurrentKeyVersion,
  getMasterKey,
  deriveKey,
  stageUserSlot,
  commitUserSlot,
  rollbackUserSlot,
  addUserSlot,
  removeUserSlot,
  rotateMasterKey,
  clear,
};

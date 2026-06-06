'use strict';

const bcrypt = require('bcryptjs');
const databaseService = require('./databaseService');
const keyService = require('./security/keyService');
const cryptoService = require('./security/cryptoService');
const { normalizeUsername } = require('./security/normalizers');

const SALT_ROUNDS = 12;
const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 1024;

function validateUsername(username) {
  const display = String(username == null ? '' : username).normalize('NFKC').trim();
  const normalized = normalizeUsername(display);
  if (!normalized) return { error: '用户名不能为空' };
  if (display.length > MAX_USERNAME_LENGTH) return { error: '用户名过长' };
  return { display, normalized };
}

function validatePassword(password, optional) {
  if (optional && !password) return null;
  if (typeof password !== 'string' || password.length < 1) return '密码不能为空';
  if (password.length > MAX_PASSWORD_LENGTH) return '密码过长';
  return null;
}

function payloadContext(recordId) {
  return { recordType: 'users', field: 'payload', recordId };
}

function decryptUser(row) {
  if (!row) return null;
  const payload = cryptoService.decryptJson(row.payload_cipher, payloadContext(row.record_id));
  return {
    id: row.id,
    username: payload.username,
    role: payload.role,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

function usernameToken(normalized, keyVersion) {
  return cryptoService.blindIndex(cryptoService.DOMAINS.USERNAME, normalized, keyVersion);
}

function roleToken(role, keyVersion) {
  return cryptoService.blindIndex(cryptoService.DOMAINS.ROLE, normalizeUsername(role), keyVersion);
}

function getUserRowById(id) {
  return databaseService.getDb().prepare(`
    SELECT id, record_id, payload_cipher, created_at, last_login
    FROM users WHERE id = ?
  `).get(Number(id));
}

function getUserById(id) {
  return decryptUser(getUserRowById(id));
}

function verifyLogin(username, password) {
  const checked = validateUsername(username);
  if (checked.error || validatePassword(password)) return null;
  const token = usernameToken(checked.normalized);
  const row = databaseService.getDb().prepare(`
    SELECT id, record_id, password_hash, payload_cipher, created_at, last_login
    FROM users
    WHERE username_token = ?
  `).get(token);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) return null;
  const lastLogin = databaseService.nowSql();
  databaseService.getDb().prepare('UPDATE users SET last_login = ? WHERE id = ?').run(lastLogin, row.id);
  row.last_login = lastLogin;
  return decryptUser(row);
}

function listUsers(opts) {
  const options = opts || {};
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 20));
  const search = normalizeUsername(String(options.search || '').slice(0, MAX_USERNAME_LENGTH));
  const rows = databaseService.getDb().prepare(`
    SELECT id, record_id, payload_cipher, created_at, last_login
    FROM users
    ORDER BY id ASC
  `).all();
  const matching = rows.map(decryptUser).filter((user) => (
    !search || normalizeUsername(user.username).includes(search)
  ));
  const offset = (page - 1) * limit;
  return {
    users: matching.slice(offset, offset + limit),
    total: matching.length,
    page,
    limit,
  };
}

function createUser(username, password) {
  const checked = validateUsername(username);
  if (checked.error) return { success: false, error: checked.error };
  const passwordError = validatePassword(password);
  if (passwordError) return { success: false, error: passwordError };

  const keyVersion = keyService.getCurrentKeyVersion();
  const recordId = cryptoService.randomRecordId();
  const createdAt = databaseService.nowSql();
  const role = 'admin';
  const payload = { username: checked.display, role };
  try {
    const result = databaseService.getDb().prepare(`
      INSERT INTO users (
        record_id, username_token, role_token, password_hash,
        payload_cipher, key_version, created_at, last_login
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      recordId,
      usernameToken(checked.normalized, keyVersion),
      roleToken(role, keyVersion),
      hashPassword(password),
      cryptoService.encryptJson(payload, payloadContext(recordId), { keyVersion }),
      keyVersion,
      createdAt
    );
    try {
      keyService.addUserSlot(Number(result.lastInsertRowid), password);
    } catch (error) {
      databaseService.getDb().prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);
      throw error;
    }
    return { success: true, user: getUserById(result.lastInsertRowid) };
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return { success: false, error: '用户名已存在' };
    throw error;
  }
}

function updateUser(id, username, newPassword) {
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId < 1) return { success: false, error: '用户不存在' };
  const checked = validateUsername(username);
  if (checked.error) return { success: false, error: checked.error };
  const passwordError = validatePassword(newPassword, true);
  if (passwordError) return { success: false, error: passwordError };
  const existing = getUserById(userId);
  if (!existing) return { success: false, error: '用户不存在' };

  const row = getUserRowById(userId);
  const keyVersion = keyService.getCurrentKeyVersion();
  const payloadCipher = cryptoService.encryptJson(
    { username: checked.display, role: existing.role },
    payloadContext(row.record_id),
    { keyVersion }
  );
  let stagedSlotId = null;
  let passwordUpdated = false;
  try {
    if (newPassword) {
      stagedSlotId = keyService.stageUserSlot(userId, newPassword);
      databaseService.getDb().prepare(`
        UPDATE users
        SET username_token = ?, role_token = ?, password_hash = ?,
            payload_cipher = ?, key_version = ?
        WHERE id = ?
      `).run(
        usernameToken(checked.normalized, keyVersion),
        roleToken(existing.role, keyVersion),
        hashPassword(newPassword),
        payloadCipher,
        keyVersion,
        userId
      );
      passwordUpdated = true;
      keyService.commitUserSlot(userId, stagedSlotId);
    } else {
      databaseService.getDb().prepare(`
        UPDATE users
        SET username_token = ?, role_token = ?, payload_cipher = ?, key_version = ?
        WHERE id = ?
      `).run(
        usernameToken(checked.normalized, keyVersion),
        roleToken(existing.role, keyVersion),
        payloadCipher,
        keyVersion,
        userId
      );
    }
    return { success: true, user: getUserById(userId) };
  } catch (error) {
    if (stagedSlotId && !passwordUpdated) {
      try {
        keyService.rollbackUserSlot(stagedSlotId);
      } catch (_rollbackError) {
        // Keep the original failure; a stale slot cannot bypass bcrypt verification.
      }
    }
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return { success: false, error: '用户名已存在' };
    throw error;
  }
}

function deleteUser(id, currentUserId) {
  const userId = Number(id);
  if (userId === Number(currentUserId)) return { success: false, error: '不能删除当前登录账号' };
  const database = databaseService.getDb();
  if (database.prepare('SELECT COUNT(*) AS count FROM users').get().count <= 1) {
    return { success: false, error: '系统至少需要保留一个账号' };
  }
  const result = database.prepare('DELETE FROM users WHERE id = ?').run(userId);
  if (!result.changes) return { success: false, error: '用户不存在' };
  keyService.removeUserSlot(userId);
  return { success: true };
}

function resetPassword(id, newPassword) {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { success: false, error: passwordError };
  const userId = Number(id);
  if (!getUserById(userId)) return { success: false, error: '用户不存在' };
  const stagedSlotId = keyService.stageUserSlot(userId, newPassword);
  let passwordUpdated = false;
  try {
    databaseService.getDb()
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(newPassword), userId);
    passwordUpdated = true;
    keyService.commitUserSlot(userId, stagedSlotId);
    return { success: true };
  } catch (error) {
    if (!passwordUpdated) {
      try {
        keyService.rollbackUserSlot(stagedSlotId);
      } catch (_rollbackError) {
        // Keep the original failure; a stale slot cannot bypass bcrypt verification.
      }
    }
    throw error;
  }
}

function seedDefaultAdmin() {
  const count = databaseService.getDb().prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count !== 0) return { created: false };
  const result = createUser('admin', 'admin123');
  return { created: !!result.success, user: result.user };
}

function saveSession(user) {
  databaseService.getDb().prepare(`
    INSERT INTO sessions (id, user_id, login_time)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      login_time = excluded.login_time
  `).run(user.id, new Date().toISOString());
}

function loadSession() {
  const session = databaseService.getDb().prepare('SELECT user_id FROM sessions WHERE id = 1').get();
  if (!session) return null;
  const user = getUserById(session.user_id);
  if (!user) clearSession();
  return user;
}

function clearSession() {
  databaseService.getDb().prepare('DELETE FROM sessions').run();
}

function closeDatabase() {
  databaseService.closeDatabase();
}

module.exports = {
  verifyLogin,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  seedDefaultAdmin,
  saveSession,
  loadSession,
  clearSession,
  closeDatabase,
};

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const DB_FILE = 'app.db';

let db = null;

function getDataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return path.join(__dirname, '..', '..', 'data');
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getFilePath(filename) {
  return path.join(ensureDataDir(), filename);
}

function getDbPath() {
  return getFilePath(DB_FILE);
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function getDb() {
  if (!db) {
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      last_login TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      login_time TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function toSafeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

function hashPassword(plainPassword) {
  return bcrypt.hashSync(plainPassword, SALT_ROUNDS);
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

function verifyLogin(username, password) {
  const database = getDb();
  const row = database
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username || '').trim());

  if (!row || !verifyPassword(password, row.password_hash)) {
    return null;
  }

  const lastLogin = nowSql();
  database.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(lastLogin, row.id);
  row.last_login = lastLogin;
  return toSafeUser(row);
}

function getUserById(id) {
  const row = getDb()
    .prepare('SELECT id, username, role, created_at, last_login FROM users WHERE id = ?')
    .get(Number(id));
  return toSafeUser(row);
}

function listUsers(opts) {
  opts = opts || {};
  const safePage = Math.max(1, parseInt(opts.page, 10) || 1);
  const safeLimit = Math.max(1, Math.min(100, parseInt(opts.limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;
  const search = String(opts.search || '').trim();
  const database = getDb();

  let total;
  let users;
  if (search) {
    const like = '%' + search + '%';
    total = database
      .prepare('SELECT COUNT(*) AS count FROM users WHERE username LIKE ?')
      .get(like).count;
    users = database
      .prepare(
        `SELECT id, username, role, created_at, last_login
         FROM users
         WHERE username LIKE ?
         ORDER BY id ASC
         LIMIT ? OFFSET ?`
      )
      .all(like, safeLimit, offset);
  } else {
    total = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    users = database
      .prepare(
        `SELECT id, username, role, created_at, last_login
         FROM users
         ORDER BY id ASC
         LIMIT ? OFFSET ?`
      )
      .all(safeLimit, offset);
  }

  return {
    users: users.map(toSafeUser),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

function createUser(username, password) {
  const trimmedUsername = String(username || '').trim();
  if (!trimmedUsername) {
    return { success: false, error: '用户名不能为空' };
  }
  if (!password || password.length < 1) {
    return { success: false, error: '密码不能为空' };
  }

  const database = getDb();
  const now = nowSql();

  try {
    const result = database
      .prepare(
        `INSERT INTO users (username, password_hash, role, created_at, last_login)
         VALUES (?, ?, 'admin', ?, NULL)`
      )
      .run(trimmedUsername, hashPassword(password), now);
    return {
      success: true,
      user: getUserById(result.lastInsertRowid),
    };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: '用户名已存在' };
    }
    throw err;
  }
}

function updateUser(id, username, newPassword) {
  const userId = Number(id);
  const trimmedUsername = String(username || '').trim();
  if (!trimmedUsername) {
    return { success: false, error: '用户名不能为空' };
  }

  const database = getDb();
  const existing = getUserById(userId);
  if (!existing) {
    return { success: false, error: '用户不存在' };
  }

  try {
    if (newPassword) {
      const update = database.transaction(() => {
        database
          .prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?')
          .run(trimmedUsername, hashPassword(newPassword), userId);
      });
      update();
    } else {
      database.prepare('UPDATE users SET username = ? WHERE id = ?').run(trimmedUsername, userId);
    }
    return { success: true, user: getUserById(userId) };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: '用户名已存在' };
    }
    throw err;
  }
}

function deleteUser(id, currentUserId) {
  const userId = Number(id);
  if (userId === Number(currentUserId)) {
    return { success: false, error: '不能删除当前登录账号' };
  }

  const database = getDb();
  const count = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count <= 1) {
    return { success: false, error: '系统至少需要保留一个账号' };
  }

  const result = database.prepare('DELETE FROM users WHERE id = ?').run(userId);
  if (result.changes === 0) {
    return { success: false, error: '用户不存在' };
  }

  return { success: true };
}

function resetPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 1) {
    return { success: false, error: '密码不能为空' };
  }

  const result = getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), Number(id));

  if (result.changes === 0) {
    return { success: false, error: '用户不存在' };
  }

  return { success: true };
}

function seedDefaultAdmin() {
  const count = getDb().prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count === 0) {
    const result = createUser('admin', 'admin123');
    console.log('[userService] Seeded default admin account (admin / admin123)');
    return { created: true, user: result.user };
  }
  return { created: false };
}

function saveSession(user) {
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, username, role, login_time)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         username = excluded.username,
         role = excluded.role,
         login_time = excluded.login_time`
    )
    .run(user.id, user.username, user.role, new Date().toISOString());
  console.log('[userService] Session saved for user', user.username);
}

function loadSession() {
  const session = getDb().prepare('SELECT user_id FROM sessions WHERE id = 1').get();
  if (!session) return null;

  const user = getUserById(session.user_id);
  if (!user) {
    clearSession();
    return null;
  }

  return user;
}

function clearSession() {
  getDb().prepare('DELETE FROM sessions').run();
  console.log('[userService] Session cleared');
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
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

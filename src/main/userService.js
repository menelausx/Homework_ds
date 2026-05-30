const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const bcrypt = require('bcryptjs');

// ── Config ─────────────────────────────────────────────────────────────────
const SALT_ROUNDS = 12;
const USERS_FILE = 'users.json';
const SESSION_FILE = 'session.json';

// ── Data directory ─────────────────────────────────────────────────────────

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

// ── User storage (JSON file — consistent with cacheService pattern) ────────

function readUsers() {
  const filePath = getFilePath(USERS_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[userService] Error reading users.json:', err.message);
    return [];
  }
}

function writeUsers(users) {
  const filePath = getFilePath(USERS_FILE);
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[userService] Error writing users.json:', err.message);
  }
}

// ── Next ID ────────────────────────────────────────────────────────────────

function getNextId(users) {
  if (users.length === 0) return 1;
  var maxId = 0;
  for (var i = 0; i < users.length; i++) {
    if (users[i].id > maxId) maxId = users[i].id;
  }
  return maxId + 1;
}

// ── Password helpers ───────────────────────────────────────────────────────

function hashPassword(plainPassword) {
  return bcrypt.hashSync(plainPassword, SALT_ROUNDS);
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

// ── Auth operations ────────────────────────────────────────────────────────

/**
 * Verify login credentials.
 * Returns the user object (without password_hash) on success, or null.
 */
function verifyLogin(username, password) {
  var users = readUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === username) {
      if (verifyPassword(password, users[i].password_hash)) {
        // Update last_login
        users[i].last_login = new Date().toISOString().replace('T', ' ').substring(0, 19);
        writeUsers(users);

        return {
          id: users[i].id,
          username: users[i].username,
          role: users[i].role,
          created_at: users[i].created_at,
          last_login: users[i].last_login,
        };
      }
      return null; // password mismatch
    }
  }
  return null; // user not found
}

/**
 * Get a user by id (safe projection, no password_hash).
 */
function getUserById(id) {
  var users = readUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      return {
        id: users[i].id,
        username: users[i].username,
        role: users[i].role,
        created_at: users[i].created_at,
        last_login: users[i].last_login,
      };
    }
  }
  return null;
}

// ── CRUD operations ────────────────────────────────────────────────────────

/**
 * List users with optional search and pagination.
 * Returns { users, total, page, limit }.
 */
function listUsers(opts) {
  opts = opts || {};
  var safePage = Math.max(1, parseInt(opts.page, 10) || 1);
  var safeLimit = Math.max(1, Math.min(100, parseInt(opts.limit, 10) || 20));
  var search = (opts.search || '').trim();

  var allUsers = readUsers();

  // Filter by search
  var filtered = allUsers;
  if (search) {
    var lowerSearch = search.toLowerCase();
    filtered = allUsers.filter(function (u) {
      return u.username.toLowerCase().indexOf(lowerSearch) !== -1;
    });
  }

  // Sort by id ascending
  filtered.sort(function (a, b) {
    return a.id - b.id;
  });

  var total = filtered.length;
  var offset = (safePage - 1) * safeLimit;
  var pageUsers = filtered.slice(offset, offset + safeLimit);

  // Strip password_hash from results
  var safeUsers = pageUsers.map(function (u) {
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      created_at: u.created_at,
      last_login: u.last_login,
    };
  });

  return {
    users: safeUsers,
    total: total,
    page: safePage,
    limit: safeLimit,
  };
}

/**
 * Create a new user.
 */
function createUser(username, password) {
  if (!username || !username.trim()) {
    return { success: false, error: '用户名不能为空' };
  }
  if (!password || password.length < 1) {
    return { success: false, error: '密码不能为空' };
  }

  var users = readUsers();
  var trimmedUsername = username.trim();

  // Check uniqueness
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === trimmedUsername) {
      return { success: false, error: '用户名已存在' };
    }
  }

  var now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  var newUser = {
    id: getNextId(users),
    username: trimmedUsername,
    password_hash: hashPassword(password),
    role: 'admin',
    created_at: now,
    last_login: null,
  };

  users.push(newUser);
  writeUsers(users);

  return {
    success: true,
    user: {
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      created_at: newUser.created_at,
      last_login: newUser.last_login,
    },
  };
}

/**
 * Update a user's username.
 */
function updateUser(id, username) {
  if (!username || !username.trim()) {
    return { success: false, error: '用户名不能为空' };
  }

  var users = readUsers();
  var trimmedUsername = username.trim();

  // Check uniqueness (exclude current user)
  for (var i = 0; i < users.length; i++) {
    if (users[i].id !== id && users[i].username === trimmedUsername) {
      return { success: false, error: '用户名已存在' };
    }
  }

  for (var i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      users[i].username = trimmedUsername;
      writeUsers(users);
      return {
        success: true,
        user: {
          id: users[i].id,
          username: users[i].username,
          role: users[i].role,
          created_at: users[i].created_at,
          last_login: users[i].last_login,
        },
      };
    }
  }

  return { success: false, error: '用户不存在' };
}

/**
 * Delete a user by id.
 * Prevent self-deletion and prevent deleting the last user.
 */
function deleteUser(id, currentUserId) {
  if (id === currentUserId) {
    return { success: false, error: '不能删除当前登录账号' };
  }

  var users = readUsers();
  if (users.length <= 1) {
    return { success: false, error: '系统至少需要保留一个账号' };
  }

  for (var i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      users.splice(i, 1);
      writeUsers(users);
      return { success: true };
    }
  }

  return { success: false, error: '用户不存在' };
}

/**
 * Reset a user's password.
 */
function resetPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 1) {
    return { success: false, error: '密码不能为空' };
  }

  var users = readUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      users[i].password_hash = hashPassword(newPassword);
      writeUsers(users);
      return { success: true };
    }
  }

  return { success: false, error: '用户不存在' };
}

/**
 * Seed a default admin account if no users exist.
 */
function seedDefaultAdmin() {
  var users = readUsers();
  if (users.length === 0) {
    createUser('admin', 'admin123');
    console.log('[userService] Seeded default admin account (admin / admin123)');
  }
}

// ── Session persistence ────────────────────────────────────────────────────

function saveSession(user) {
  var sessionData = {
    userId: user.id,
    username: user.username,
    role: user.role,
    loginTime: new Date().toISOString(),
  };
  var filePath = getFilePath(SESSION_FILE);
  fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf8');
  console.log('[userService] Session saved for user', user.username);
}

function loadSession() {
  var filePath = getFilePath(SESSION_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    var data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    var user = getUserById(data.userId);
    if (!user) return null;
    return user;
  } catch (err) {
    console.error('[userService] Failed to load session:', err.message);
    return null;
  }
}

function clearSession() {
  var filePath = getFilePath(SESSION_FILE);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  console.log('[userService] Session cleared');
}

// ── Module exports ─────────────────────────────────────────────────────────

module.exports = {
  // Auth
  verifyLogin,
  getUserById,

  // CRUD
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,

  // Lifecycle
  seedDefaultAdmin,

  // Session
  saveSession,
  loadSession,
  clearSession,
};

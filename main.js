const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const faaService = require('./src/main/faaService');
const openskyService = require('./src/main/openskyService');
const userService = require('./src/main/userService');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: '数据安全动态采集系统',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Auth IPC handlers ──────────────────────────────────────────────────────

function setupAuthIpcHandlers() {
  ipcMain.handle('auth:login', async (_event, username, password) => {
    try {
      const user = userService.verifyLogin(username, password);
      if (!user) {
        return { success: false, error: '用户名或密码错误' };
      }
      userService.saveSession(user);
      // Don't log passwords!
      console.log('[auth] User logged in:', user.username);
      return { success: true, user };
    } catch (error) {
      console.error('[auth] Login error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      userService.clearSession();
      console.log('[auth] User logged out');
      return { success: true };
    } catch (error) {
      console.error('[auth] Logout error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:me', async () => {
    try {
      const user = userService.loadSession();
      return user || null;
    } catch (error) {
      console.error('[auth] Session check error:', error.message);
      return null;
    }
  });
}

// ── User management IPC handlers ───────────────────────────────────────────

function setupUsersIpcHandlers() {
  ipcMain.handle('users:list', async (_event, opts) => {
    try {
      return userService.listUsers(opts);
    } catch (error) {
      console.error('[users] List error:', error.message);
      return { users: [], total: 0, page: 1, limit: 20, error: error.message };
    }
  });

  ipcMain.handle('users:create', async (_event, username, password) => {
    try {
      const result = userService.createUser(username, password);
      if (result.success && result.user) {
        console.log('[users] Created user:', result.user.username, '(id=' + result.user.id + ')');
      }
      return result;
    } catch (error) {
      console.error('[users] Create error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('users:update', async (_event, id, username) => {
    try {
      const result = userService.updateUser(id, username);
      if (result.success) {
        console.log('[users] Updated user id=' + id + ' to username=' + username);
      }
      return result;
    } catch (error) {
      console.error('[users] Update error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('users:delete', async (_event, id) => {
    try {
      // The current user id is passed implicitly via session — we look it up
      const currentUser = userService.loadSession();
      const currentUserId = currentUser ? currentUser.id : null;
      const result = userService.deleteUser(id, currentUserId);
      if (result.success) {
        console.log('[users] Deleted user id=' + id);
      }
      return result;
    } catch (error) {
      console.error('[users] Delete error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('users:resetPassword', async (_event, id, newPassword) => {
    try {
      const result = userService.resetPassword(id, newPassword);
      if (result.success) {
        console.log('[users] Password reset for user id=' + id);
      }
      return result;
    } catch (error) {
      console.error('[users] ResetPassword error:', error.message);
      return { success: false, error: error.message };
    }
  });
}

// ── FAA handlers ────────────────────────────────────────────────────────────

function setupFaaIpcHandlers() {
  ipcMain.handle('faa:get-stats', async () => {
    return faaService.getStats();
  });

  ipcMain.handle('faa:get-info', async (_event, icao24) => {
    if (!icao24) return null;
    return faaService.getAircraftInfo(icao24);
  });

  ipcMain.handle('faa:get-info-bulk', async (_event, icao24List) => {
    const result = {};
    for (const icao24 of icao24List) {
      const info = faaService.getAircraftInfo(icao24);
      if (info) result[icao24] = info;
    }
    return result;
  });

  ipcMain.handle('faa:refresh', async () => {
    try {
      const result = await faaService.refresh();
      return { success: true, recordCount: result.recordCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// ── OpenSky handlers ────────────────────────────────────────────────────────

function setupOpenskyIpcHandlers() {
  ipcMain.handle('opensky:get-flights', async () => {
    return openskyService.getCachedFlights();
  });

  ipcMain.handle('opensky:refresh', async () => {
    try {
      const result = await openskyService.refresh();
      return { success: true, flightCount: result.states.length, cacheTime: result.cacheTime };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // 1. Seed default admin account if no users exist
  userService.seedDefaultAdmin();

  // 2. Create the window (login page loads first)
  createWindow();

  // 3. Register all IPC handlers
  setupAuthIpcHandlers();
  setupUsersIpcHandlers();
  setupFaaIpcHandlers();
  setupOpenskyIpcHandlers();

  // 4. Load FAA database in background, notify renderer when done
  faaService
    .initialize()
    .then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('faa:ready', faaService.getStats());
      }
    })
    .catch((err) => {
      console.error('FAA initialization error:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('faa:error', err.message);
      }
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

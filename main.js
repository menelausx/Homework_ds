const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const keyService = require('./src/main/security/keyService');
const userService = require('./src/main/userService');
const dataSourceService = require('./src/main/dataSourceService');
const databaseService = require('./src/main/databaseService');
const analysisService = require('./src/main/analysisService');
const ntsbAnalysisService = require('./src/main/ntsbAnalysisService');
const cacheService = require('./src/main/cacheService');

app.setPath('userData', path.join(databaseService.getDataDir(), 'electron-profile'));
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
let defaultAdminCreated = false;

function errorCode(error) {
  return error && typeof error.code === 'string' ? error.code : 'OPERATION_FAILED';
}

function logFailure(scope, error) {
  console.error('[' + scope + '] failed:', errorCode(error));
}

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
    let unlockedForAttempt = false;
    try {
      if (
        typeof username !== 'string'
        || username.length > 128
        || typeof password !== 'string'
        || password.length > 1024
      ) {
        return { success: false, error: '用户名或密码错误' };
      }
      if (!keyService.isUnlocked()) {
        keyService.unlock(password);
        unlockedForAttempt = true;
      }
      const user = userService.verifyLogin(username, password);
      if (!user) {
        if (unlockedForAttempt) {
          databaseService.closeDatabase();
          keyService.lock();
        }
        return { success: false, error: '用户名或密码错误' };
      }
      userService.saveSession(user);
      // Don't log passwords!
      console.log('[auth] Login succeeded');
      return { success: true, user };
    } catch (error) {
      if (unlockedForAttempt || errorCode(error) === 'UNLOCK_FAILED') {
        databaseService.closeDatabase();
        keyService.lock();
      }
      logFailure('auth:login', error);
      return { success: false, error: '用户名或密码错误' };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      if (keyService.isUnlocked()) userService.clearSession();
      databaseService.closeDatabase();
      keyService.lock();
      console.log('[auth] User logged out');
      return { success: true };
    } catch (error) {
      logFailure('auth:logout', error);
      return { success: false, error: '退出失败' };
    }
  });

  ipcMain.handle('auth:me', async () => {
    try {
      if (!keyService.isUnlocked()) return null;
      const user = userService.loadSession();
      return user || null;
    } catch (error) {
      logFailure('auth:me', error);
      return null;
    }
  });

  ipcMain.handle('auth:bootstrapInfo', async () => {
    return {
      defaultAdminCreated,
    };
  });
}

// ── User management IPC handlers ───────────────────────────────────────────

function setupUsersIpcHandlers() {
  ipcMain.handle('users:list', async (_event, opts) => {
    try {
      return userService.listUsers(opts);
    } catch (error) {
      logFailure('users:list', error);
      return { users: [], total: 0, page: 1, limit: 20, error: '读取用户失败' };
    }
  });

  ipcMain.handle('users:create', async (_event, username, password) => {
    try {
      const result = userService.createUser(username, password);
      if (result.success && result.user) {
        console.log('[users] Created user id=' + result.user.id);
      }
      return result;
    } catch (error) {
      logFailure('users:create', error);
      return { success: false, error: '创建用户失败' };
    }
  });

  ipcMain.handle('users:update', async (_event, id, username, password) => {
    try {
      const result = userService.updateUser(id, username, password);
      if (result.success) {
        console.log('[users] Updated user id=' + Number(id));
      }
      return result;
    } catch (error) {
      logFailure('users:update', error);
      return { success: false, error: '更新用户失败' };
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
      logFailure('users:delete', error);
      return { success: false, error: '删除用户失败' };
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
      logFailure('users:resetPassword', error);
      return { success: false, error: '重置密码失败' };
    }
  });
}

// ── Data Source Import IPC handlers ─────────────────────────────────────────

function setupDataSourceIpcHandlers() {
  ipcMain.handle('dataSources:list', async () => {
    try {
      return dataSourceService.listSources();
    } catch (error) {
      console.error('[dataSources] List error:', error.message);
      return [];
    }
  });

  ipcMain.handle('dataSources:status', async (_event, sourceId) => {
    try {
      return dataSourceService.getStatus(sourceId);
    } catch (error) {
      console.error('[dataSources] Status error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dataSources:download', async (_event, sourceId) => {
    try {
      const result = await dataSourceService.download(sourceId);
      console.log('[dataSources] Download ' + sourceId + ': ' + (result.success ? 'ok' : 'failed - ' + result.error));
      return result;
    } catch (error) {
      console.error('[dataSources] Download error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dataSources:parse', async (_event, sourceId) => {
    try {
      const result = await dataSourceService.parse(sourceId);
      console.log('[dataSources] Parse ' + sourceId + ': ' + (result.success ? 'ok' : 'failed - ' + result.error));
      return result;
    } catch (error) {
      console.error('[dataSources] Parse error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dataSources:import', async (_event, sourceId) => {
    try {
      const result = await dataSourceService.importToDb(sourceId);
      console.log('[dataSources] Import ' + sourceId + ': ' + (result.success ? 'ok' : 'failed - ' + result.error));
      return result;
    } catch (error) {
      console.error('[dataSources] Import error:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dataSources:updateAll', async (_event, sourceId) => {
    try {
      const result = await dataSourceService.updateAll(sourceId);
      console.log('[dataSources] UpdateAll ' + sourceId + ': ' + (result.success ? 'ok' : 'failed - ' + result.error));
      return result;
    } catch (error) {
      console.error('[dataSources] UpdateAll error:', error.message);
      return { success: false, error: error.message, phases: ['failed'] };
    }
  });

  ipcMain.handle('dataSources:cleanCache', async () => {
    try {
      const result = cacheService.cleanRawDataCache();
      console.log('[dataSources] Clean cache: deleted ' + result.deletedCount + ' item(s)');
      return result;
    } catch (error) {
      console.error('[dataSources] Clean cache error:', error.message);
      return { success: false, error: error.message };
    }
  });
}

// ── Shell IPC handlers ──────────────────────────────────────────────────────

function setupShellIpcHandlers() {
  ipcMain.handle('shell:openExternal', async (_event, url) => {
    try {
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Invalid URL' };
      }
      // Only allow http/https URLs
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: 'Only http/https URLs are allowed' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('[shell] openExternal error:', error.message);
      return { success: false, error: error.message };
    }
  });
}

// ── Analysis IPC handlers (SQLite-backed, no external API calls) ────────────

function setupAnalysisIpcHandlers() {
  ipcMain.handle('analysis:getFlights', async () => {
    try {
      return analysisService.getFlights();
    } catch (error) {
      console.error('[analysis] getFlights error:', error.message);
      return { time: 0, cacheTime: null, states: [], snapshotTime: null };
    }
  });

  ipcMain.handle('analysis:getFlight', async (_event, icao24) => {
    try {
      if (typeof icao24 !== 'string' || icao24.length > 32) return null;
      return analysisService.getFlight(icao24);
    } catch (error) {
      console.error('[analysis] getFlight error:', error.message);
      return null;
    }
  });

  ipcMain.handle('analysis:getStatistics', async () => {
    try {
      return analysisService.getStatistics();
    } catch (error) {
      console.error('[analysis] getStatistics error:', error.message);
      return { flightCount: 0, faaMatched: 0, faaTotalRecords: 0, faaLoaded: false, faaError: error.message, snapshotTime: null };
    }
  });

  ipcMain.handle('analysis:getFaaInfo', async (_event, icao24) => {
    try {
      if (typeof icao24 !== 'string' || icao24.length > 32) return null;
      return analysisService.getFaaInfo(icao24);
    } catch (error) {
      console.error('[analysis] getFaaInfo error:', error.message);
      return null;
    }
  });

  ipcMain.handle('analysis:getFaaInfoBulk', async (_event, icao24List) => {
    try {
      if (!Array.isArray(icao24List) || icao24List.length > 2000) return {};
      return analysisService.getFaaInfoBulk(icao24List);
    } catch (error) {
      console.error('[analysis] getFaaInfoBulk error:', error.message);
      return {};
    }
  });
}

// ── NTSB Analysis IPC handlers (aggregate SQLite queries) ─────────────────

function setupNtsbAnalysisIpcHandlers() {
  ipcMain.handle('ntsb:getFilterOptions', async () => {
    try {
      return ntsbAnalysisService.getFilterOptions();
    } catch (error) {
      console.error('[ntsb] getFilterOptions error:', error.message);
      return { years: { min: null, max: null }, countries: [], states: [], severities: [], aircraftCategories: [], damages: [] };
    }
  });

  ipcMain.handle('ntsb:getOverview', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getOverview(filters);
    } catch (error) {
      console.error('[ntsb] getOverview error:', error.message);
      return { totalEvents: 0, fatalEvents: 0, fatalRate: 0, aircraftCount: 0, geoEventCount: 0, narrativeEventCount: 0, topRegion: null };
    }
  });

  ipcMain.handle('ntsb:getYearlyTrend', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getYearlyTrend(filters);
    } catch (error) {
      console.error('[ntsb] getYearlyTrend error:', error.message);
      return [];
    }
  });

  ipcMain.handle('ntsb:getSeverityDistribution', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getSeverityDistribution(filters);
    } catch (error) {
      console.error('[ntsb] getSeverityDistribution error:', error.message);
      return [];
    }
  });

  ipcMain.handle('ntsb:getGeoAggregation', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getGeoAggregation(filters);
    } catch (error) {
      console.error('[ntsb] getGeoAggregation error:', error.message);
      return [];
    }
  });

  ipcMain.handle('ntsb:getAircraftBreakdown', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getAircraftBreakdown(filters);
    } catch (error) {
      console.error('[ntsb] getAircraftBreakdown error:', error.message);
      return { categories: [], makes: [], models: [], damages: [], ageBuckets: [] };
    }
  });

  ipcMain.handle('ntsb:getWeatherBreakdown', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getWeatherBreakdown(filters);
    } catch (error) {
      console.error('[ntsb] getWeatherBreakdown error:', error.message);
      return { light: [], conditions: [], visibility: [], wind: [] };
    }
  });

  ipcMain.handle('ntsb:getFindingBreakdown', async (_event, filters) => {
    try {
      return ntsbAnalysisService.getFindingBreakdown(filters);
    } catch (error) {
      console.error('[ntsb] getFindingBreakdown error:', error.message);
      return { categories: [], topFindings: [], severityMatrix: [] };
    }
  });

  ipcMain.handle('ntsb:searchNarratives', async (_event, query) => {
    try {
      if (typeof query !== 'string' || query.length > 500) return [];
      return ntsbAnalysisService.searchNarratives(query);
    } catch (error) {
      logFailure('ntsb:searchNarratives', error);
      return [];
    }
  });

  ipcMain.handle('ntsb:searchFindings', async (_event, query) => {
    try {
      if (typeof query !== 'string' || query.length > 500) return [];
      return ntsbAnalysisService.searchFindings(query);
    } catch (error) {
      logFailure('ntsb:searchFindings', error);
      return [];
    }
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  try {
    const security = keyService.initialize({
      dataDir: databaseService.getDataDir(),
      bootstrap: { userId: 1, password: 'admin123' },
    });
    if (security.created) {
      const seedResult = userService.seedDefaultAdmin();
      if (!seedResult.created) throw new Error('Default administrator bootstrap failed.');
      defaultAdminCreated = true;
      userService.clearSession();
      databaseService.closeDatabase();
      keyService.lock();
    }
  } catch (error) {
    logFailure('startup', error);
    dialog.showErrorBox(
      '安全存储初始化失败',
      error && error.code === 'LEGACY_DATABASE'
        ? '检测到旧版明文数据库。请删除 data/app.db、app.db-wal 和 app.db-shm 后重新启动。'
        : '无法初始化便携 keyring 或密态数据库。应用已停止，以避免明文降级。'
    );
    app.quit();
    return;
  }
  // 1. Create the window (the database remains locked until login)
  createWindow();

  // 2. Register all IPC handlers
  setupAuthIpcHandlers();
  setupUsersIpcHandlers();
  setupDataSourceIpcHandlers();
  setupShellIpcHandlers();
  setupAnalysisIpcHandlers();
  setupNtsbAnalysisIpcHandlers();

  // 3. App is ready — no background FAA loading needed.
  //    Analysis page reads from SQLite via analysis: IPC channels.
  //    Use the "数据采集入库" page to download/import data first.

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  userService.closeDatabase();
  databaseService.closeDatabase();
  keyService.clear();
  app.quit();
});

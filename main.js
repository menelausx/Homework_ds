const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const userService = require('./src/main/userService');
const dataSourceService = require('./src/main/dataSourceService');
const databaseService = require('./src/main/databaseService');
const analysisService = require('./src/main/analysisService');
const ntsbAnalysisService = require('./src/main/ntsbAnalysisService');
const cacheService = require('./src/main/cacheService');

let mainWindow = null;
let defaultAdminCreated = false;

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

  ipcMain.handle('users:update', async (_event, id, username, password) => {
    try {
      const result = userService.updateUser(id, username, password);
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
      return analysisService.getFaaInfo(icao24);
    } catch (error) {
      console.error('[analysis] getFaaInfo error:', error.message);
      return null;
    }
  });

  ipcMain.handle('analysis:getFaaInfoBulk', async (_event, icao24List) => {
    try {
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
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // 1. Seed default admin account if no users exist
  const seedResult = userService.seedDefaultAdmin();
  defaultAdminCreated = !!seedResult.created;
  if (defaultAdminCreated) {
    userService.clearSession();
  }

  // 2. Create the window (login page loads first)
  createWindow();

  // 3. Register all IPC handlers
  setupAuthIpcHandlers();
  setupUsersIpcHandlers();
  setupDataSourceIpcHandlers();
  setupShellIpcHandlers();
  setupAnalysisIpcHandlers();
  setupNtsbAnalysisIpcHandlers();

  // 4. App is ready — no background FAA loading needed.
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
  app.quit();
});

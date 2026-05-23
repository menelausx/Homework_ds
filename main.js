const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const faaService = require('./src/main/faaService');
const openskyService = require('./src/main/openskyService');

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

function setupIpcHandlers() {
  // FAA handlers
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

  // OpenSky handlers
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

app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();

  // Load FAA database in background, notify renderer when done
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

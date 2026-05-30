const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getCurrentUser: () => ipcRenderer.invoke('auth:me'),
  getBootstrapInfo: () => ipcRenderer.invoke('auth:bootstrapInfo'),

  // ── User Management ───────────────────────────────────────────────────────
  listUsers: (opts) => ipcRenderer.invoke('users:list', opts),
  createUser: (username, password) => ipcRenderer.invoke('users:create', username, password),
  updateUser: (id, username, password) => ipcRenderer.invoke('users:update', id, username, password),
  deleteUser: (id) => ipcRenderer.invoke('users:delete', id),
  resetUserPassword: (id, newPassword) => ipcRenderer.invoke('users:resetPassword', id, newPassword),

  // ── FAA ───────────────────────────────────────────────────────────────────
  getFaaStats: () => ipcRenderer.invoke('faa:get-stats'),
  getFaaInfo: (icao24) => ipcRenderer.invoke('faa:get-info', icao24),
  getFaaInfoBulk: (icao24List) => ipcRenderer.invoke('faa:get-info-bulk', icao24List),
  refreshFaa: () => ipcRenderer.invoke('faa:refresh'),

  // ── OpenSky ───────────────────────────────────────────────────────────────
  getFlightData: () => ipcRenderer.invoke('opensky:get-flights'),
  refreshFlights: () => ipcRenderer.invoke('opensky:refresh'),

  // ── Data Source Import ──────────────────────────────────────────────────
  listDataSources: () => ipcRenderer.invoke('dataSources:list'),
  getDataSourceStatus: (sourceId) => ipcRenderer.invoke('dataSources:status', sourceId),
  downloadDataSource: (sourceId) => ipcRenderer.invoke('dataSources:download', sourceId),
  parseDataSource: (sourceId) => ipcRenderer.invoke('dataSources:parse', sourceId),
  importDataSource: (sourceId) => ipcRenderer.invoke('dataSources:import', sourceId),
  updateAllDataSource: (sourceId) => ipcRenderer.invoke('dataSources:updateAll', sourceId),

  // ── Shell ──────────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── Event listeners from main process ─────────────────────────────────────
  onFaaReady: (callback) => {
    ipcRenderer.on('faa:ready', (_event, stats) => callback(stats));
  },
  onFaaError: (callback) => {
    ipcRenderer.on('faa:error', (_event, error) => callback(error));
  },
});

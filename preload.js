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

  // ── Analysis (SQLite-backed, read-only) ──────────────────────────────────
  getFlights: () => ipcRenderer.invoke('analysis:getFlights'),
  getFlight: (icao24) => ipcRenderer.invoke('analysis:getFlight', icao24),
  getStatistics: () => ipcRenderer.invoke('analysis:getStatistics'),
  getFaaInfo: (icao24) => ipcRenderer.invoke('analysis:getFaaInfo', icao24),
  getFaaInfoBulk: (icao24List) => ipcRenderer.invoke('analysis:getFaaInfoBulk', icao24List),

  // ── Data Source Import ──────────────────────────────────────────────────
  listDataSources: () => ipcRenderer.invoke('dataSources:list'),
  getDataSourceStatus: (sourceId) => ipcRenderer.invoke('dataSources:status', sourceId),
  downloadDataSource: (sourceId) => ipcRenderer.invoke('dataSources:download', sourceId),
  parseDataSource: (sourceId) => ipcRenderer.invoke('dataSources:parse', sourceId),
  importDataSource: (sourceId) => ipcRenderer.invoke('dataSources:import', sourceId),
  updateAllDataSource: (sourceId) => ipcRenderer.invoke('dataSources:updateAll', sourceId),

  // ── Shell ──────────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});

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
  updateUser: (id, username) => ipcRenderer.invoke('users:update', id, username),
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

  // ── Event listeners from main process ─────────────────────────────────────
  onFaaReady: (callback) => {
    ipcRenderer.on('faa:ready', (_event, stats) => callback(stats));
  },
  onFaaError: (callback) => {
    ipcRenderer.on('faa:error', (_event, error) => callback(error));
  },
});

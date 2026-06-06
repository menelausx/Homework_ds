const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: (username, password, rememberLogin) => ipcRenderer.invoke(
    'auth:login',
    username,
    password,
    rememberLogin === true
  ),
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

  // ── NTSB Accident Trend Analysis (aggregate SQLite queries) ─────────────
  getNtsbFilterOptions: () => ipcRenderer.invoke('ntsb:getFilterOptions'),
  getNtsbOverview: (filters) => ipcRenderer.invoke('ntsb:getOverview', filters),
  getNtsbYearlyTrend: (filters) => ipcRenderer.invoke('ntsb:getYearlyTrend', filters),
  getNtsbSeverityDistribution: (filters) => ipcRenderer.invoke('ntsb:getSeverityDistribution', filters),
  getNtsbGeoAggregation: (filters) => ipcRenderer.invoke('ntsb:getGeoAggregation', filters),
  getNtsbAircraftBreakdown: (filters) => ipcRenderer.invoke('ntsb:getAircraftBreakdown', filters),
  getNtsbWeatherBreakdown: (filters) => ipcRenderer.invoke('ntsb:getWeatherBreakdown', filters),
  getNtsbFindingBreakdown: (filters) => ipcRenderer.invoke('ntsb:getFindingBreakdown', filters),
  searchNtsbNarratives: (query) => ipcRenderer.invoke('ntsb:searchNarratives', query),
  searchNtsbFindings: (query) => ipcRenderer.invoke('ntsb:searchFindings', query),

  // ── Data Source Import ──────────────────────────────────────────────────
  listDataSources: () => ipcRenderer.invoke('dataSources:list'),
  getDataSourceStatus: (sourceId) => ipcRenderer.invoke('dataSources:status', sourceId),
  downloadDataSource: (sourceId) => ipcRenderer.invoke('dataSources:download', sourceId),
  parseDataSource: (sourceId) => ipcRenderer.invoke('dataSources:parse', sourceId),
  importDataSource: (sourceId) => ipcRenderer.invoke('dataSources:import', sourceId),
  updateAllDataSource: (sourceId) => ipcRenderer.invoke('dataSources:updateAll', sourceId),
  cleanDataSourceCache: () => ipcRenderer.invoke('dataSources:cleanCache'),

  // ── Shell ──────────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});

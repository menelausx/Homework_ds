const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // FAA
  getFaaStats: () => ipcRenderer.invoke('faa:get-stats'),
  getFaaInfo: (icao24) => ipcRenderer.invoke('faa:get-info', icao24),
  getFaaInfoBulk: (icao24List) => ipcRenderer.invoke('faa:get-info-bulk', icao24List),
  refreshFaa: () => ipcRenderer.invoke('faa:refresh'),

  // OpenSky
  getFlightData: () => ipcRenderer.invoke('opensky:get-flights'),
  refreshFlights: () => ipcRenderer.invoke('opensky:refresh'),

  // Event listeners from main process
  onFaaReady: (callback) => {
    ipcRenderer.on('faa:ready', (_event, stats) => callback(stats));
  },
  onFaaError: (callback) => {
    ipcRenderer.on('faa:error', (_event, error) => callback(error));
  },
});

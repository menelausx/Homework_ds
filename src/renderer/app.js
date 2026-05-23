// ==================== State ====================
const state = {
  flightData: { time: 0, cacheTime: null, states: [] },
  faaStats: { recordCount: 0, loaded: false, error: null },
  faaCache: new Map(),
  selectedIcao24: null,
  selectedMarkerCopies: null,
  flightLayer: null,
  markers: {},
};

// ==================== Map Setup ====================
const map = L.map('map', {
  center: [39.5, -98.0],
  zoom: 4,
  minZoom: 2,
  maxZoom: 18,
  zoomControl: true,
  preferCanvas: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
  detectRetina: false,
}).addTo(map);

state.flightLayer = L.layerGroup().addTo(map);

// ==================== DOM References ====================
const $ = (sel) => document.querySelector(sel);

const btnRefreshFlights = $('#btn-refresh-flights');
const btnRefreshFaa = $('#btn-refresh-faa');
const btnDetailClose = $('#btn-detail-close');
const statFlightCount = $('#stat-flight-count');
const statFaaMatched = $('#stat-faa-matched');
const statFaaRecords = $('#stat-faa-records');
const statCacheTime = $('#stat-cache-time');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const loadingOverlay = $('#loading-overlay');
const loadingText = $('#loading-text');
const faaPlaceholder = $('#faa-placeholder');
const faaInfoContent = $('#faa-info-content');
const faaNoMatch = $('#faa-no-match');
const detailPlaceholder = $('#detail-placeholder');
const detailGrid = $('#detail-grid');

// ==================== Utility ====================
function setStatus(st, text) {
  statusDot.className = 'status-dot';
  if (st === 'loading') statusDot.classList.add('loading');
  if (st === 'error') statusDot.classList.add('error');
  statusText.textContent = text;
}

function showLoading(text) {
  loadingText.textContent = text || '加载中...';
  loadingOverlay.style.display = '';
}

function hideLoading() {
  loadingOverlay.style.display = 'none';
}

function formatTime(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (_) {
    return '--';
  }
}

function formatUnixTimestamp(ts) {
  if (!ts || ts === 0) return '--';
  try {
    const d = new Date(ts * 1000);
    return d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (_) {
    return String(ts);
  }
}

function showEl(el) { el.style.display = ''; }
function hideEl(el) { el.style.display = 'none'; }

// ==================== Marker Helpers ====================
const MARKER_STYLE = {
  matched: {
    radius: 6,
    color: '#c0392b',
    fillColor: '#e06c75',
    fillOpacity: 0.85,
    weight: 1.5,
  },
  unmatched: {
    radius: 5,
    color: '#1a5276',
    fillColor: '#58a6ff',
    fillOpacity: 0.7,
    weight: 1,
  },
  selected: {
    radius: 9,
    color: '#39c5cf',
    fillColor: '#ffffff',
    fillOpacity: 0.95,
    weight: 3,
  },
};

function getMarkerStyle(icao24, isSelected) {
  if (isSelected) return MARKER_STYLE.selected;
  const faaInfo = state.faaCache.get(icao24);
  return faaInfo ? MARKER_STYLE.matched : MARKER_STYLE.unmatched;
}

function createMarker(flight, lonOffset) {
  const lon = flight.longitude + (lonOffset || 0);
  const marker = L.circleMarker(
    [flight.latitude, lon],
    getMarkerStyle(flight.icao24, false)
  );

  marker.icao24 = flight.icao24;

  marker.on('click', () => selectFlight(flight.icao24));

  const label = flight.callsign || flight.icao24;
  marker.bindTooltip(label, {
    direction: 'top',
    offset: [0, -8],
    opacity: 0.9,
    className: 'marker-tooltip',
  });

  return marker;
}

// ==================== Viewport-Driven Marker Rendering ====================
let updatePending = false;

function updateVisibleMarkers() {
  if (updatePending) return;
  updatePending = true;
  requestAnimationFrame(() => {
    updatePending = false;
    _doUpdateVisibleMarkers();
  });
}

function _doUpdateVisibleMarkers() {
  if (!state.flightData.states.length) return;

  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  // Padding: 50% viewport width on each side for smooth panning
  const lngPad = (east - west) * 0.5;
  const latPad = (north - south) * 0.3;
  const visWest = west - lngPad;
  const visEast = east + lngPad;
  const visSouth = south - latPad;
  const visNorth = north + latPad;

  state.flightLayer.clearLayers();
  const newMarkers = {};
  const prevSelected = state.selectedIcao24;
  let foundSelected = false;

  for (const flight of state.flightData.states) {
    const lat = flight.latitude;
    const lon = flight.longitude;
    if (lat == null || lon == null) continue;
    if (lat < visSouth || lat > visNorth) continue;

    // Compute which world copies of this flight fall within the visible longitude range
    // World n places the flight at lon + n*360
    const nMin = Math.ceil((visWest - lon) / 360);
    const nMax = Math.floor((visEast - lon) / 360);

    if (nMin > nMax) continue;

    const copies = [];
    for (let n = nMin; n <= nMax; n++) {
      const marker = createMarker(flight, n * 360);
      state.flightLayer.addLayer(marker);
      copies.push(marker);
    }

    newMarkers[flight.icao24] = copies;

    if (flight.icao24 === prevSelected) {
      foundSelected = true;
      state.selectedMarkerCopies = copies;
      for (const m of copies) {
        m.setStyle(MARKER_STYLE.selected);
        m.bringToFront();
      }
    }
  }

  state.markers = newMarkers;

  if (!foundSelected) {
    state.selectedIcao24 = null;
    state.selectedMarkerCopies = null;
  }
}

// ==================== FAA Preload (batch, async, non-blocking) ====================
let faaPreloadRunning = false;

async function preloadFaaCache() {
  if (faaPreloadRunning) return;
  faaPreloadRunning = true;

  try {
    const uncached = state.flightData.states
      .map(f => f.icao24)
      .filter(id => !state.faaCache.has(id));

    const BATCH = 2000;
    for (let i = 0; i < uncached.length; i += BATCH) {
      const batch = uncached.slice(i, i + BATCH);

      const results = await window.electronAPI.getFaaInfoBulk(batch);

      for (const icao24 of batch) {
        if (results[icao24]) {
          state.faaCache.set(icao24, results[icao24]);
        } else {
          state.faaCache.set(icao24, null);
        }
      }

      // Update visible marker styles in-place (no flicker)
      for (const icao24 of batch) {
        const copies = state.markers[icao24];
        if (copies && state.selectedIcao24 !== icao24) {
          const style = state.faaCache.get(icao24) ? MARKER_STYLE.matched : MARKER_STYLE.unmatched;
          for (const m of copies) {
            m.setStyle(style);
          }
        }
      }

      updateStats();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (err) {
    console.error('FAA preload error:', err);
  } finally {
    faaPreloadRunning = false;
  }
}

function updateStats() {
  statFlightCount.textContent = state.flightData.states.length;
  statCacheTime.textContent = formatTime(state.flightData.cacheTime);
  let matched = 0;
  for (const info of state.faaCache.values()) {
    if (info) matched++;
  }
  statFaaMatched.textContent = matched;
}

// ==================== Selection ====================
async function selectFlight(icao24) {
  if (state.selectedMarkerCopies) {
    for (const m of state.selectedMarkerCopies) {
      m.setStyle(getMarkerStyle(state.selectedIcao24, false));
    }
  }

  const copies = state.markers[icao24];
  if (!copies || copies.length === 0) return;

  state.selectedIcao24 = icao24;
  state.selectedMarkerCopies = copies;
  for (const m of copies) {
    m.setStyle(MARKER_STYLE.selected);
    m.bringToFront();
  }

  const flight = state.flightData.states.find((f) => f.icao24 === icao24);
  if (flight) {
    showFlightDetail(flight);
  }

  await showFaaInfo(icao24);
}

function deselectFlight() {
  if (state.selectedMarkerCopies) {
    for (const m of state.selectedMarkerCopies) {
      m.setStyle(getMarkerStyle(state.selectedIcao24, false));
    }
    state.selectedMarkerCopies = null;
    state.selectedIcao24 = null;
  }
  hideFlightDetail();
  hideFaaInfo();
}

// ==================== Detail Bar ====================
function showFlightDetail(flight) {
  hideEl(detailPlaceholder);
  showEl(detailGrid);

  const fields = [
    'icao24', 'callsign', 'origin_country', 'time_position', 'last_contact',
    'longitude', 'latitude', 'baro_altitude', 'on_ground', 'velocity',
    'true_track', 'vertical_rate', 'sensors', 'geo_altitude', 'squawk',
    'spi', 'position_source',
  ];

  for (const field of fields) {
    const el = detailGrid.querySelector(`[data-dfield="${field}"]`);
    if (!el) continue;
    let val = flight[field];
    if (val == null) val = '-';
    if (field === 'time_position' || field === 'last_contact') {
      val = formatUnixTimestamp(val);
    }
    if (field === 'on_ground') {
      val = val === true ? 'Yes' : val === false ? 'No' : String(val);
    }
    el.textContent = String(val);
  }
}

function hideFlightDetail() {
  showEl(detailPlaceholder);
  hideEl(detailGrid);
}

// ==================== FAA Panel ====================
async function showFaaInfo(icao24) {
  let faaInfo = state.faaCache.get(icao24);

  if (faaInfo === undefined) {
    faaInfo = await window.electronAPI.getFaaInfo(icao24);
    state.faaCache.set(icao24, faaInfo || null);
  }

  if (faaInfo) {
    hideEl(faaPlaceholder);
    hideEl(faaNoMatch);
    showEl(faaInfoContent);

    const fields = [
      'N-NUMBER', 'NAME', 'CITY', 'STATE', 'COUNTRY', 'YEAR MFR',
      'MODE S CODE HEX', 'SERIAL NUMBER', 'TYPE AIRCRAFT', 'TYPE ENGINE',
      'CERTIFICATION', 'STATUS CODE', 'EXPIRATION DATE',
    ];

    for (const field of fields) {
      const el = faaInfoContent.querySelector(`[data-field="${field}"]`);
      if (!el) continue;
      el.textContent = faaInfo[field] || '-';
    }
  } else {
    hideEl(faaPlaceholder);
    hideEl(faaInfoContent);
    showEl(faaNoMatch);
  }
}

function hideFaaInfo() {
  showEl(faaPlaceholder);
  hideEl(faaInfoContent);
  hideEl(faaNoMatch);
}

// ==================== FAA Stats Display ====================
function updateFaaStatsDisplay() {
  if (state.faaStats.error && !state.faaStats.loaded) {
    statFaaRecords.textContent = '未加载';
  } else {
    statFaaRecords.textContent = state.faaStats.loaded
      ? state.faaStats.recordCount.toLocaleString()
      : '加载中...';
  }
}

// ==================== Load & Refresh ====================
async function loadInitialData() {
  try {
    state.faaStats = await window.electronAPI.getFaaStats();
    updateFaaStatsDisplay();

    state.flightData = await window.electronAPI.getFlightData();
    if (state.flightData.states.length > 0) {
      updateVisibleMarkers();
      preloadFaaCache();
      updateStats();
      setStatus('ok', '已加载缓存数据 (' + state.flightData.states.length + ' 架航班)');
    } else {
      updateStats();
      setStatus('ok', '就绪 - 请点击“刷新航班数据”获取航班信息');
    }
  } catch (err) {
    console.error('Initial load error:', err);
    setStatus('error', '加载失败: ' + err.message);
  }
}

async function refreshFlights() {
  setStatus('loading', '正在获取航班数据...');
  btnRefreshFlights.disabled = true;

  try {
    const result = await window.electronAPI.refreshFlights();
    if (result.success) {
      state.flightData = await window.electronAPI.getFlightData();
      state.faaCache.clear();
      deselectFlight();
      updateVisibleMarkers();
      preloadFaaCache();
      updateStats();
      setStatus('ok', '航班数据已刷新 (' + result.flightCount + ' 架航班)');
    } else {
      setStatus('error', '航班刷新失败: ' + result.error);
    }
  } catch (err) {
    setStatus('error', '航班刷新失败: ' + err.message);
  } finally {
    btnRefreshFlights.disabled = false;
  }
}

async function refreshFaaDatabase() {
  setStatus('loading', '正在下载 FAA 数据库 (文件较大，约50-100MB，请耐心等待)...');
  btnRefreshFaa.disabled = true;
  showLoading('正在下载 FAA 数据库...\n文件较大，可能需要几分钟');

  try {
    const result = await window.electronAPI.refreshFaa();
    if (result.success) {
      state.faaStats = await window.electronAPI.getFaaStats();
      updateFaaStatsDisplay();
      state.faaCache.clear();

      if (state.flightData.states.length > 0) {
        deselectFlight();
        updateVisibleMarkers();
        preloadFaaCache();
        updateStats();
      }

      setStatus('ok', 'FAA 数据库已刷新 (' + result.recordCount.toLocaleString() + ' 条记录)');
    } else {
      setStatus('error', 'FAA 刷新失败: ' + result.error);
    }
  } catch (err) {
    setStatus('error', 'FAA 刷新失败: ' + err.message);
  } finally {
    btnRefreshFaa.disabled = false;
    hideLoading();
  }
}

// ==================== Event Listeners ====================
btnRefreshFlights.addEventListener('click', refreshFlights);
btnRefreshFaa.addEventListener('click', refreshFaaDatabase);
btnDetailClose.addEventListener('click', deselectFlight);

// Viewport-driven reactive rendering
map.on('moveend', updateVisibleMarkers);
map.on('zoomend', updateVisibleMarkers);

// Map click on empty space deselects
map.on('click', (e) => {
  if (e.originalEvent.target === map.getContainer() ||
      e.originalEvent.target.classList.contains('leaflet-container')) {
    deselectFlight();
  }
});

// FAA ready event from main process
window.electronAPI.onFaaReady((stats) => {
  state.faaStats = stats;
  updateFaaStatsDisplay();

  if (state.flightData.states.length > 0) {
    state.faaCache.clear();
    preloadFaaCache();
  }
  setStatus('ok', 'FAA 数据库加载完成 (' + stats.recordCount.toLocaleString() + ' 条记录)');
});

window.electronAPI.onFaaError((error) => {
  state.faaStats.error = error;
  updateFaaStatsDisplay();
  setStatus('error', 'FAA 数据库: ' + error);
});

// Keyboard shortcut: Escape to deselect
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    deselectFlight();
  }
});

// ==================== Init ====================
loadInitialData();

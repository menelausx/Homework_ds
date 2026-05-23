// ==================== State ====================
const state = {
  flightData: { time: 0, cacheTime: null, states: [] },
  faaStats: { recordCount: 0, loaded: false, error: null },
  faaCache: new Map(),        // local cache of FAA lookups: icao24 -> record | null
  selectedIcao24: null,
  selectedMarker: null,
  flightLayer: null,
  markers: {},                // icao24 -> marker
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
function setStatus(state, text) {
  statusDot.className = 'status-dot';
  if (state === 'loading') statusDot.classList.add('loading');
  if (state === 'error') statusDot.classList.add('error');
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

function createMarker(flight) {
  const marker = L.circleMarker(
    [flight.latitude, flight.longitude],
    getMarkerStyle(flight.icao24, false)
  );

  marker.icao24 = flight.icao24;

  marker.on('click', () => selectFlight(flight.icao24));

  // Tooltip with callsign
  const label = flight.callsign || flight.icao24;
  marker.bindTooltip(label, {
    direction: 'top',
    offset: [0, -8],
    opacity: 0.9,
    className: 'marker-tooltip',
  });

  return marker;
}

// ==================== Flight Display ====================
function clearMarkers() {
  state.flightLayer.clearLayers();
  state.markers = {};
  state.selectedIcao24 = null;
  state.selectedMarker = null;
}

function renderFlights() {
  clearMarkers();

  const flights = state.flightData.states;
  let faaMatchedCount = 0;

  for (const flight of flights) {
    if (flight.latitude == null || flight.longitude == null) continue;

    // Check FAA match
    if (!state.faaCache.has(flight.icao24)) {
      // Look up on first render
      window.electronAPI.getFaaInfo(flight.icao24).then((info) => {
        state.faaCache.set(flight.icao24, info || null);
        if (info) {
          // Update marker style if still on map
          const marker = state.markers[flight.icao24];
          if (marker && state.selectedIcao24 !== flight.icao24) {
            marker.setStyle(MARKER_STYLE.matched);
          }
          updateFaaMatchedCount();
        }
      });
    } else if (state.faaCache.get(flight.icao24)) {
      faaMatchedCount++;
    }

    const marker = createMarker(flight);
    state.flightLayer.addLayer(marker);
    state.markers[flight.icao24] = marker;
  }

  updateStats();
}

function updateFaaMatchedCount() {
  let count = 0;
  for (const [icao24, info] of state.faaCache) {
    if (info) count++;
  }
  statFaaMatched.textContent = count;
}

function updateStats() {
  statFlightCount.textContent = state.flightData.states.length;
  statCacheTime.textContent = formatTime(state.flightData.cacheTime);
  updateFaaMatchedCount();
}

// ==================== Selection ====================
async function selectFlight(icao24) {
  // Deselect previous
  if (state.selectedMarker) {
    const prevIcao = state.selectedIcao24;
    const style = getMarkerStyle(prevIcao, false);
    state.selectedMarker.setStyle(style);
  }

  // Select new
  const marker = state.markers[icao24];
  if (!marker) return;

  state.selectedIcao24 = icao24;
  state.selectedMarker = marker;
  marker.setStyle(MARKER_STYLE.selected);
  marker.bringToFront();

  // Show flight detail
  const flight = state.flightData.states.find((f) => f.icao24 === icao24);
  if (flight) {
    showFlightDetail(flight);
  }

  // Show FAA info
  await showFaaInfo(icao24);
}

function deselectFlight() {
  if (state.selectedMarker) {
    const style = getMarkerStyle(state.selectedIcao24, false);
    state.selectedMarker.setStyle(style);
    state.selectedMarker = null;
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
  // Check cache first
  let faaInfo = state.faaCache.get(icao24);

  if (faaInfo === undefined) {
    // Not cached yet - look up
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
    // Load FAA stats
    state.faaStats = await window.electronAPI.getFaaStats();
    updateFaaStatsDisplay();

    // Load cached flight data
    state.flightData = await window.electronAPI.getFlightData();
    if (state.flightData.states.length > 0) {
      renderFlights();
      setStatus('ok', '已加载缓存数据 (' + state.flightData.states.length + ' 架航班)');
    } else {
      setStatus('ok', '就绪 - 请点击"刷新航班数据"获取航班信息');
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
      renderFlights();
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

      // Re-render to update marker colors
      if (state.flightData.states.length > 0) {
        renderFlights();
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

// Map click on empty space deselects
map.on('click', (e) => {
  // Only deselect if clicking on the map background (not on a marker)
  if (e.originalEvent.target === map.getContainer() ||
      e.originalEvent.target.classList.contains('leaflet-container')) {
    deselectFlight();
  }
});

// Listen for FAA ready event from main process
window.electronAPI.onFaaReady((stats) => {
  state.faaStats = stats;
  updateFaaStatsDisplay();
  // Clear cache to re-lookup with newly loaded FAA data
  if (state.flightData.states.length > 0) {
    const oldFaaCache = state.faaCache;
    state.faaCache.clear();
    // Update existing markers
    for (const [icao24, marker] of Object.entries(state.markers)) {
      window.electronAPI.getFaaInfo(icao24).then((info) => {
        state.faaCache.set(icao24, info || null);
        if (info && state.selectedIcao24 !== icao24) {
          marker.setStyle(MARKER_STYLE.matched);
        }
        updateFaaMatchedCount();
      });
    }
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

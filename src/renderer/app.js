// ==================== SVG Airplane Icon ====================
// Source: src/renderer/assets/flight.svg — airplane pointing north (0° = true_track 0°)
const AIRPLANE_PATH = 'M280-80v-100l120-84v-144L80-280v-120l320-224v-176q0-33 23.5-56.5T480-880q33 0 56.5 23.5T560-800v176l320 224v120L560-408v144l120 84v100l-200-60-200 60Z';

const MATCHED_COLOR = '#e06c75';
const UNMATCHED_COLOR = '#58a6ff';
const SELECTED_COLOR = '#ffffff';

function buildAirplaneSVG(fillColor, rotation, glow) {
  const glowFilter = glow ? 'drop-shadow(0 0 6px rgba(57,197,207,0.9))' : '';
  const baseFilter = 'drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.45))';
  const filter = glow ? glowFilter + ' ' + baseFilter : baseFilter;

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 -960 960 960" width="28px"' +
    ' fill="' + fillColor + '" stroke="rgba(0,0,0,0.3)" stroke-width="18"' +
    ' style="display:block;transform:rotate(' + rotation + 'deg);transform-origin:center;filter:' + filter + ';">' +
    '<path d="' + AIRPLANE_PATH + '"/></svg>'
  );
}

function createAirplaneIcon(icao24, trueTrack, isSelected) {
  const faaInfo = state.faaCache.get(icao24);
  let fillColor;
  if (isSelected) {
    fillColor = SELECTED_COLOR;
  } else if (faaInfo) {
    fillColor = MATCHED_COLOR;
  } else {
    fillColor = UNMATCHED_COLOR;
  }

  return L.divIcon({
    html: buildAirplaneSVG(fillColor, trueTrack || 0, isSelected),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    className: 'airplane-marker',
  });
}

// ==================== DOM-based marker style helpers ====================
function setMarkerDOMColor(marker, fillColor, glow) {
  var el = marker.getElement();
  if (!el) return;
  var svg = el.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('fill', fillColor);
  var glowFilter = glow ? 'drop-shadow(0 0 6px rgba(57,197,207,0.9))' : '';
  var baseFilter = 'drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.45))';
  svg.style.filter = glow ? glowFilter + ' ' + baseFilter : baseFilter;
}

function applyMarkerStyleFromCache(marker) {
  var icao24 = marker.icao24;
  var faaInfo = state.faaCache.get(icao24);
  var fillColor = faaInfo ? MATCHED_COLOR : UNMATCHED_COLOR;
  setMarkerDOMColor(marker, fillColor, false);
}

function setMarkerSelectedDOM(marker, isSelected) {
  if (isSelected) {
    setMarkerDOMColor(marker, SELECTED_COLOR, true);
    marker.setZIndexOffset(1000);
  } else {
    applyMarkerStyleFromCache(marker);
    marker.setZIndexOffset(0);
  }
}

// ==================== State ====================
var state = {
  flightData: { time: 0, cacheTime: null, states: [] },
  faaStats: { recordCount: 0, loaded: false, error: null },
  faaCache: new Map(),
  selectedIcao24: null,
  selectedMarkerCopies: null,
  flightLayer: null,
  markers: {},
};

// ==================== Map Setup ====================
var map = L.map('map', {
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
var $ = function (sel) { return document.querySelector(sel); };

var btnRefreshFlights = $('#btn-refresh-flights');
var btnRefreshFaa = $('#btn-refresh-faa');
var btnDetailClose = $('#btn-detail-close');
var statFlightCount = $('#stat-flight-count');
var statFaaMatched = $('#stat-faa-matched');
var statFaaRecords = $('#stat-faa-records');
var statCacheTime = $('#stat-cache-time');
var statusDot = $('#status-dot');
var statusText = $('#status-text');
var loadingOverlay = $('#loading-overlay');
var loadingText = $('#loading-text');
var faaPlaceholder = $('#faa-placeholder');
var faaInfoContent = $('#faa-info-content');
var faaNoMatch = $('#faa-no-match');
var detailPlaceholder = $('#detail-placeholder');
var detailGrid = $('#detail-grid');

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
    var d = new Date(isoString);
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
    var d = new Date(ts * 1000);
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

// ==================== Marker Creation ====================
function createMarker(flight, lonOffset) {
  var lon = flight.longitude + (lonOffset || 0);
  var icon = createAirplaneIcon(flight.icao24, flight.true_track, false);
  var marker = L.marker([flight.latitude, lon], { icon: icon });

  marker.icao24 = flight.icao24;

  marker.on('click', function () {
    selectFlight(flight.icao24);
  });

  var label = flight.callsign || flight.icao24;
  marker.bindTooltip(label, {
    direction: 'top',
    offset: [0, -18],
    opacity: 0.9,
    className: 'marker-tooltip',
  });

  return marker;
}

// ==================== Viewport-Driven Marker Rendering ====================
var updatePending = false;

function updateVisibleMarkers() {
  if (updatePending) return;
  updatePending = true;
  requestAnimationFrame(function () {
    updatePending = false;
    _doUpdateVisibleMarkers();
  });
}

function _doUpdateVisibleMarkers() {
  if (!state.flightData.states.length) return;

  var bounds = map.getBounds();
  var west = bounds.getWest();
  var east = bounds.getEast();
  var south = bounds.getSouth();
  var north = bounds.getNorth();

  var lngPad = (east - west) * 0.5;
  var latPad = (north - south) * 0.3;
  var visWest = west - lngPad;
  var visEast = east + lngPad;
  var visSouth = south - latPad;
  var visNorth = north + latPad;

  state.flightLayer.clearLayers();
  var newMarkers = {};
  var prevSelected = state.selectedIcao24;
  var foundSelected = false;

  for (var i = 0; i < state.flightData.states.length; i++) {
    var flight = state.flightData.states[i];
    var lat = flight.latitude;
    var lon = flight.longitude;
    if (lat == null || lon == null) continue;
    if (lat < visSouth || lat > visNorth) continue;

    var nMin = Math.ceil((visWest - lon) / 360);
    var nMax = Math.floor((visEast - lon) / 360);
    if (nMin > nMax) continue;

    var copies = [];
    for (var n = nMin; n <= nMax; n++) {
      var marker = createMarker(flight, n * 360);
      state.flightLayer.addLayer(marker);
      copies.push(marker);
    }

    newMarkers[flight.icao24] = copies;

    if (flight.icao24 === prevSelected) {
      foundSelected = true;
      state.selectedMarkerCopies = copies;
      for (var k = 0; k < copies.length; k++) {
        setMarkerSelectedDOM(copies[k], true);
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
var faaPreloadRunning = false;

async function preloadFaaCache() {
  if (faaPreloadRunning) return;
  faaPreloadRunning = true;

  try {
    var uncached = [];
    for (var i = 0; i < state.flightData.states.length; i++) {
      var id = state.flightData.states[i].icao24;
      if (!state.faaCache.has(id)) {
        uncached.push(id);
      }
    }

    var BATCH = 2000;
    for (var i = 0; i < uncached.length; i += BATCH) {
      var batch = uncached.slice(i, i + BATCH);
      var results = await window.electronAPI.getFaaInfoBulk(batch);

      for (var j = 0; j < batch.length; j++) {
        var icao24 = batch[j];
        state.faaCache.set(icao24, results[icao24] || null);
      }

      // Update visible marker colors in-place
      for (var k = 0; k < batch.length; k++) {
        var icao = batch[k];
        var copies = state.markers[icao];
        if (copies && state.selectedIcao24 !== icao) {
          for (var m = 0; m < copies.length; m++) {
            applyMarkerStyleFromCache(copies[m]);
          }
        }
      }

      updateStats();
      await new Promise(function (resolve) { return setTimeout(resolve, 50); });
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
  var matched = 0;
  var cache = state.faaCache;
  // Iterate values manually to avoid iterator overhead
  cache.forEach(function (info) {
    if (info) matched++;
  });
  statFaaMatched.textContent = matched;
}

// ==================== Selection ====================
async function selectFlight(icao24) {
  // Deselect previous
  if (state.selectedMarkerCopies) {
    for (var i = 0; i < state.selectedMarkerCopies.length; i++) {
      setMarkerSelectedDOM(state.selectedMarkerCopies[i], false);
    }
  }

  var copies = state.markers[icao24];
  if (!copies || copies.length === 0) return;

  state.selectedIcao24 = icao24;
  state.selectedMarkerCopies = copies;
  for (var j = 0; j < copies.length; j++) {
    setMarkerSelectedDOM(copies[j], true);
  }

  var flight;
  for (var k = 0; k < state.flightData.states.length; k++) {
    if (state.flightData.states[k].icao24 === icao24) {
      flight = state.flightData.states[k];
      break;
    }
  }
  if (flight) {
    showFlightDetail(flight);
  }

  await showFaaInfo(icao24);
}

function deselectFlight() {
  if (state.selectedMarkerCopies) {
    for (var i = 0; i < state.selectedMarkerCopies.length; i++) {
      setMarkerSelectedDOM(state.selectedMarkerCopies[i], false);
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

  var fields = [
    'icao24', 'callsign', 'origin_country', 'time_position', 'last_contact',
    'longitude', 'latitude', 'baro_altitude', 'on_ground', 'velocity',
    'true_track', 'vertical_rate', 'sensors', 'geo_altitude', 'squawk',
    'spi', 'position_source',
  ];

  for (var i = 0; i < fields.length; i++) {
    var el = detailGrid.querySelector('[data-dfield="' + fields[i] + '"]');
    if (!el) continue;
    var val = flight[fields[i]];
    if (val == null) val = '-';
    if (fields[i] === 'time_position' || fields[i] === 'last_contact') {
      val = formatUnixTimestamp(val);
    }
    if (fields[i] === 'on_ground') {
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
  var faaInfo = state.faaCache.get(icao24);

  if (faaInfo === undefined) {
    faaInfo = await window.electronAPI.getFaaInfo(icao24);
    state.faaCache.set(icao24, faaInfo || null);
  }

  if (faaInfo) {
    hideEl(faaPlaceholder);
    hideEl(faaNoMatch);
    showEl(faaInfoContent);

    var fields = [
      'N-NUMBER', 'NAME', 'CITY', 'STATE', 'COUNTRY', 'YEAR MFR',
      'MODE S CODE HEX', 'SERIAL NUMBER', 'TYPE AIRCRAFT', 'TYPE ENGINE',
      'CERTIFICATION', 'STATUS CODE', 'EXPIRATION DATE',
    ];

    for (var i = 0; i < fields.length; i++) {
      var el = faaInfoContent.querySelector('[data-field="' + fields[i] + '"]');
      if (!el) continue;
      el.textContent = faaInfo[fields[i]] || '-';
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
    var result = await window.electronAPI.refreshFlights();
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
    var result = await window.electronAPI.refreshFaa();
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

map.on('moveend', updateVisibleMarkers);
map.on('zoomend', updateVisibleMarkers);

map.on('click', function (e) {
  if (e.originalEvent.target === map.getContainer() ||
      e.originalEvent.target.classList.contains('leaflet-container')) {
    deselectFlight();
  }
});

window.electronAPI.onFaaReady(function (stats) {
  state.faaStats = stats;
  updateFaaStatsDisplay();

  if (state.flightData.states.length > 0) {
    state.faaCache.clear();
    preloadFaaCache();
  }
  setStatus('ok', 'FAA 数据库加载完成 (' + stats.recordCount.toLocaleString() + ' 条记录)');
});

window.electronAPI.onFaaError(function (error) {
  state.faaStats.error = error;
  updateFaaStatsDisplay();
  setStatus('error', 'FAA 数据库: ' + error);
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    deselectFlight();
  }
});

// ==================== Init ====================
loadInitialData();

// ==================== App Module ====================
// Main application controller: tab switching, FAA/OpenSky module initialization.

var AppModule = (function () {
  'use strict';

  // ── Tab switching ───────────────────────────────────────────────────────

  var tabFaaOpensky = document.getElementById('tab-faa-opensky');
  var tabImport = document.getElementById('tab-import');
  var tabAdmin = document.getElementById('tab-admin');
  var moduleFaaOpensky = document.getElementById('module-faa-opensky');
  var moduleImport = document.getElementById('module-import');
  var moduleAdmin = document.getElementById('module-admin');

  var activeTab = 'faa-opensky';

  function switchTab(tabName) {
    if (activeTab === tabName) return;
    activeTab = tabName;

    // Update tab active states
    var tabs = document.querySelectorAll('.tab-bar .tab[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-tab') === tabName) {
        tabs[i].classList.add('active');
      } else {
        tabs[i].classList.remove('active');
      }
    }

    // Hide all modules first
    if (moduleFaaOpensky) moduleFaaOpensky.style.display = 'none';
    if (moduleImport) moduleImport.style.display = 'none';
    if (moduleAdmin) moduleAdmin.style.display = 'none';

    // Show/hide module content
    if (tabName === 'faa-opensky') {
      if (moduleFaaOpensky) moduleFaaOpensky.style.display = '';
      // Trigger map resize if it was hidden
      if (typeof FaaOpenskyModule !== 'undefined' && FaaOpenskyModule.onActivate) {
        FaaOpenskyModule.onActivate();
      }
    } else if (tabName === 'import') {
      if (moduleImport) moduleImport.style.display = '';
      if (typeof ImportModule !== 'undefined' && ImportModule.onActivate) {
        ImportModule.onActivate();
      }
    } else if (tabName === 'admin') {
      if (moduleAdmin) moduleAdmin.style.display = '';
      if (typeof AdminModule !== 'undefined' && AdminModule.onActivate) {
        AdminModule.onActivate();
      }
    }
  }

  if (tabFaaOpensky) {
    tabFaaOpensky.addEventListener('click', function () {
      switchTab('faa-opensky');
    });
  }

  if (tabImport) {
    tabImport.addEventListener('click', function () {
      switchTab('import');
    });
  }

  if (tabAdmin) {
    tabAdmin.addEventListener('click', function () {
      switchTab('admin');
    });
  }

  // ── Auth lifecycle callbacks (called by LoginModule) ────────────────────

  function onLogin(user) {
    console.log('App: user logged in:', user ? user.username : null);
    // If FaaOpenskyModule was deferred, initialize it now
    if (typeof FaaOpenskyModule !== 'undefined' && FaaOpenskyModule.initialize) {
      FaaOpenskyModule.initialize();
    }
  }

  function onLogout() {
    console.log('App: user logged out');
    // Return to FAA/OpenSky tab
    switchTab('faa-opensky');
  }

  // ── Status helper (used by AdminModule for error notifications) ─────────

  function setStatus(type, text) {
    if (typeof FaaOpenskyModule !== 'undefined' && FaaOpenskyModule.setStatus) {
      FaaOpenskyModule.setStatus(type, text);
    }
  }

  // ── Exports ─────────────────────────────────────────────────────────────
  return {
    switchTab: switchTab,
    onLogin: onLogin,
    onLogout: onLogout,
    setStatus: setStatus,
  };
})();

// ==================== FAA / OpenSky Module ====================
// Wrapped as FaaOpenskyModule so initialization can be deferred until login.

var FaaOpenskyModule = (function () {
  'use strict';

  // Track whether this module has been fully initialized
  var initialized = false;

  // ==================== SVG Airplane Icon ====================
  var AIRPLANE_PATH =
    'M280-80v-100l120-84v-144L80-280v-120l320-224v-176q0-33 23.5-56.5T480-880q33 0 56.5 23.5T560-800v176l320 224v120L560-408v144l120 84v100l-200-60-200 60Z';

  var MATCHED_COLOR = '#e06c75';
  var UNMATCHED_COLOR = '#58a6ff';
  var SELECTED_COLOR = '#ffc846';
  var AIRPLANE_SIZE = 28;
  var AIRPLANE_HIT_RADIUS = 14;

  // ==================== State ====================
  var state = {
    flightData: { time: 0, cacheTime: null, states: [] },
    faaStats: { recordCount: 0, loaded: false, error: null },
    faaCache: new Map(),
    selectedIcao24: null,
    flightLayer: null,
    flightByIcao: {},
  };

  function getFlightByIcao(icao24) {
    return state.flightByIcao[icao24] || null;
  }

  function rebuildFlightIndex() {
    var nextIndex = {};
    for (var i = 0; i < state.flightData.states.length; i++) {
      var flight = state.flightData.states[i];
      if (flight.icao24) nextIndex[flight.icao24] = flight;
    }
    state.flightByIcao = nextIndex;
  }

  function getFlightFillColor(icao24, isSelected) {
    if (isSelected) return SELECTED_COLOR;
    return state.faaCache.get(icao24) ? MATCHED_COLOR : UNMATCHED_COLOR;
  }

  // ==================== Canvas Aircraft Layer ====================
  var AircraftCanvasLayer = L.Layer.extend({
    onAdd: function (mapInstance) {
      this._map = mapInstance;
      this._canvas = L.DomUtil.create('canvas', 'flight-canvas-layer');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      this._hitBoxes = [];
      this._drawPending = false;
      this._airplanePath = new Path2D(AIRPLANE_PATH);

      mapInstance.getPanes().overlayPane.appendChild(this._canvas);
      mapInstance.on('resize moveend zoomend viewreset', this.redraw, this);
      mapInstance.on('click', this._onClick, this);
      this._reset();
    },

    onRemove: function (mapInstance) {
      mapInstance.off('resize moveend zoomend viewreset', this.redraw, this);
      mapInstance.off('click', this._onClick, this);
      L.DomUtil.remove(this._canvas);
      this._canvas = null;
      this._map = null;
      this._hitBoxes = [];
    },

    redraw: function () {
      if (!this._map || this._drawPending) return;
      var self = this;
      this._drawPending = true;
      requestAnimationFrame(function () {
        self._drawPending = false;
        self._reset();
        self._draw();
      });
    },

    _reset: function () {
      if (!this._map || !this._canvas) return;
      var size = this._map.getSize();
      var pixelRatio = window.devicePixelRatio || 1;
      var topLeft = this._map.containerPointToLayerPoint([0, 0]);

      L.DomUtil.setPosition(this._canvas, topLeft);
      this._canvas.style.width = size.x + 'px';
      this._canvas.style.height = size.y + 'px';

      var canvasWidth = Math.max(1, Math.round(size.x * pixelRatio));
      var canvasHeight = Math.max(1, Math.round(size.y * pixelRatio));
      if (this._canvas.width !== canvasWidth) this._canvas.width = canvasWidth;
      if (this._canvas.height !== canvasHeight) this._canvas.height = canvasHeight;
    },

    _draw: function () {
      if (!this._map || !this._canvas) return;

      var ctx = this._canvas.getContext('2d');
      var size = this._map.getSize();
      var pixelRatio = window.devicePixelRatio || 1;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      this._hitBoxes = [];

      if (!state.flightData.states.length) return;

      var bounds = this._map.getBounds();
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
      var topLeft = this._map.containerPointToLayerPoint([0, 0]);
      var selectedCopies = [];
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

        for (var n = nMin; n <= nMax; n++) {
          var point = this._map.latLngToLayerPoint([lat, lon + n * 360]).subtract(topLeft);
          if (
            point.x < -AIRPLANE_SIZE ||
            point.x > size.x + AIRPLANE_SIZE ||
            point.y < -AIRPLANE_SIZE ||
            point.y > size.y + AIRPLANE_SIZE
          ) {
            continue;
          }

          var hitBox = { x: point.x, y: point.y, flight: flight };
          this._hitBoxes.push(hitBox);

          if (flight.icao24 === state.selectedIcao24) {
            foundSelected = true;
            selectedCopies.push(hitBox);
          } else {
            this._drawAircraft(
              ctx,
              point.x,
              point.y,
              flight.true_track || 0,
              getFlightFillColor(flight.icao24, false),
              false
            );
          }
        }
      }

      for (var j = 0; j < selectedCopies.length; j++) {
        var selected = selectedCopies[j];
        this._drawAircraft(ctx, selected.x, selected.y, selected.flight.true_track || 0, SELECTED_COLOR, true);
      }

      if (state.selectedIcao24 && !foundSelected) {
        state.selectedIcao24 = null;
        hideFlightDetail();
        hideFaaInfo();
      }
    },

    _drawAircraft: function (ctx, x, y, rotation, fillColor, isSelected) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rotation || 0) * Math.PI / 180);
      ctx.scale(AIRPLANE_SIZE / 960, AIRPLANE_SIZE / 960);
      ctx.translate(-480, 480);

      if (isSelected) {
        ctx.shadowColor = 'rgba(57,197,207,0.9)';
        ctx.shadowBlur = 180;
      }

      ctx.lineWidth = 30;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.fillStyle = fillColor;
      ctx.stroke(this._airplanePath);
      ctx.fill(this._airplanePath);
      ctx.restore();
    },

    _onClick: function (e) {
      if (!this._map || !this._hitBoxes.length) return;

      var topLeft = this._map.containerPointToLayerPoint([0, 0]);
      var point = this._map.mouseEventToLayerPoint(e.originalEvent).subtract(topLeft);
      var radiusSq = AIRPLANE_HIT_RADIUS * AIRPLANE_HIT_RADIUS;

      for (var i = this._hitBoxes.length - 1; i >= 0; i--) {
        var hit = this._hitBoxes[i];
        var dx = point.x - hit.x;
        var dy = point.y - hit.y;
        if (dx * dx + dy * dy <= radiusSq) {
          e.originalEvent._aircraftHandled = true;
          selectFlight(hit.flight.icao24);
          return;
        }
      }
    },
  });

  // ==================== Map Setup ====================
  var map;

  function setupMap() {
    map = L.map('map', {
      center: [39.5, -98.0],
      zoom: 4,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: true,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      detectRetina: false,
    }).addTo(map);

    state.flightLayer = new AircraftCanvasLayer();
    map.addLayer(state.flightLayer);

    // Map events
    map.on('moveend', updateVisibleMarkers);
    map.on('zoomend', updateVisibleMarkers);

    map.on('click', function (e) {
      if (e.originalEvent._aircraftHandled) return;
      if (
        e.originalEvent.target === map.getContainer() ||
        e.originalEvent.target.classList.contains('leaflet-container')
      ) {
        deselectFlight();
      }
    });
  }

  // ==================== DOM References ====================
  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var btnRefreshAnalysis, btnDetailClose;
  var statFlightCount, statFaaMatched, statFaaRecords, statCacheTime;
  var statusDot, statusText;
  var loadingOverlay, loadingText;
  var faaPlaceholder, faaInfoContent, faaNoMatch;
  var detailPlaceholder, detailGrid;

  function cacheDomRefs() {
    btnRefreshAnalysis = $('#btn-refresh-analysis');
    btnDetailClose = $('#btn-detail-close');
    statFlightCount = $('#stat-flight-count');
    statFaaMatched = $('#stat-faa-matched');
    statFaaRecords = $('#stat-faa-records');
    statCacheTime = $('#stat-cache-time');
    statusDot = $('#status-dot');
    statusText = $('#status-text');
    loadingOverlay = $('#loading-overlay');
    loadingText = $('#loading-text');
    faaPlaceholder = $('#faa-placeholder');
    faaInfoContent = $('#faa-info-content');
    faaNoMatch = $('#faa-no-match');
    detailPlaceholder = $('#detail-placeholder');
    detailGrid = $('#detail-grid');
  }

  // ==================== Utility ====================
  function setStatus(st, text) {
    if (!statusDot || !statusText) return;
    statusDot.className = 'status-dot';
    if (st === 'loading') statusDot.classList.add('loading');
    if (st === 'error') statusDot.classList.add('error');
    statusText.textContent = text;
  }

  function showLoading(text) {
    if (!loadingOverlay || !loadingText) return;
    loadingText.textContent = text || '加载中...';
    loadingOverlay.style.display = '';
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  function formatTime(isoString) {
    if (!isoString) return '--';
    try {
      var d = new Date(isoString);
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
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
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (_) {
      return String(ts);
    }
  }

  function showEl(el) {
    if (el) el.style.display = '';
  }
  function hideEl(el) {
    if (el) el.style.display = 'none';
  }

  // ==================== Viewport-Driven Aircraft Rendering ====================
  var updatePending = false;

  function updateVisibleMarkers() {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(function () {
      updatePending = false;
      if (state.flightLayer) state.flightLayer.redraw();
    });
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

        if (state.flightLayer) state.flightLayer.redraw();
        updateStats();
        await new Promise(function (resolve) {
          return setTimeout(resolve, 50);
        });
      }
    } catch (err) {
      console.error('FAA preload error:', err);
    } finally {
      faaPreloadRunning = false;
    }
  }

  function updateStats() {
    if (statFlightCount) statFlightCount.textContent = state.flightData.states.length;
    if (statCacheTime) statCacheTime.textContent = formatTime(state.flightData.cacheTime);
    var matched = 0;
    var cache = state.faaCache;
    cache.forEach(function (info) {
      if (info) matched++;
    });
    if (statFaaMatched) statFaaMatched.textContent = matched;
  }

  // ==================== Selection ====================
  async function selectFlight(icao24) {
    var flight = getFlightByIcao(icao24);
    if (!flight) return;
    state.selectedIcao24 = icao24;
    if (state.flightLayer) state.flightLayer.redraw();

    showFlightDetail(flight);

    await showFaaInfo(icao24);
  }

  function deselectFlight() {
    state.selectedIcao24 = null;
    if (state.flightLayer) state.flightLayer.redraw();
    hideFlightDetail();
    hideFaaInfo();
  }

  // ==================== Detail Bar ====================
  function showFlightDetail(flight) {
    hideEl(detailPlaceholder);
    showEl(detailGrid);

    var fields = [
      'icao24',
      'callsign',
      'origin_country',
      'time_position',
      'last_contact',
      'longitude',
      'latitude',
      'baro_altitude',
      'on_ground',
      'velocity',
      'true_track',
      'vertical_rate',
      'sensors',
      'geo_altitude',
      'squawk',
      'spi',
      'position_source',
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
        'N-NUMBER',
        'NAME',
        'CITY',
        'STATE',
        'COUNTRY',
        'YEAR MFR',
        'MODE S CODE HEX',
        'SERIAL NUMBER',
        'TYPE AIRCRAFT',
        'TYPE ENGINE',
        'CERTIFICATION',
        'STATUS CODE',
        'EXPIRATION DATE',
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

  // ==================== Statistics (from SQLite via analysis:getStatistics) ===
  function updateStatsFromDb(stats) {
    if (!stats) return;
    if (statFlightCount) statFlightCount.textContent = stats.flightCount.toLocaleString();
    if (statFaaMatched) statFaaMatched.textContent = stats.faaMatched.toLocaleString();
    if (statFaaRecords) {
      statFaaRecords.textContent = stats.faaTotalRecords > 0
        ? stats.faaTotalRecords.toLocaleString()
        : '0';
    }
    if (statCacheTime) statCacheTime.textContent = formatUnixTimestamp(stats.snapshotTime);
  }

  // ==================== Load & Refresh (SQLite only, no external API) ========
  async function loadFromDatabase() {
    setStatus('loading', '正在从数据库加载数据...');

    try {
      state.flightData = await window.electronAPI.getFlights();
      rebuildFlightIndex();

      var stats = await window.electronAPI.getStatistics();
      updateStatsFromDb(stats);

      if (state.flightData.states.length > 0) {
        state.faaCache.clear();
        updateVisibleMarkers();
        preloadFaaCache();
        setStatus('ok', '已加载 ' + state.flightData.states.length + ' 架航班（快照: ' + formatUnixTimestamp(stats.snapshotTime) + '）');
      } else {
        updateVisibleMarkers();
        setStatus('ok', '暂无航班数据 — 请先在"数据采集入库"页面导入 OpenSky 和 FAA 数据');
      }
    } catch (err) {
      console.error('Database load error:', err);
      setStatus('error', '数据库查询失败: ' + err.message);
    }
  }

  async function loadInitialData() {
    await loadFromDatabase();
  }

  async function refreshFromDatabase() {
    setStatus('loading', '正在刷新分析数据...');
    if (btnRefreshAnalysis) btnRefreshAnalysis.disabled = true;
    state.faaCache.clear();
    deselectFlight();

    try {
      await loadFromDatabase();
    } catch (err) {
      setStatus('error', '刷新失败: ' + err.message);
    } finally {
      if (btnRefreshAnalysis) btnRefreshAnalysis.disabled = false;
    }
  }

  // ==================== Event Listeners ====================
  function bindEvents() {
    if (btnRefreshAnalysis) btnRefreshAnalysis.addEventListener('click', refreshFromDatabase);
    if (btnDetailClose) btnDetailClose.addEventListener('click', deselectFlight);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        // Don't deselect if a modal is open — let the modal handler close it
        var modals = document.querySelectorAll('.modal-overlay');
        var anyModalOpen = false;
        for (var i = 0; i < modals.length; i++) {
          if (modals[i].style.display !== 'none') {
            anyModalOpen = true;
            break;
          }
        }
        if (!anyModalOpen) {
          deselectFlight();
        }
      }
    });
  }

  // ==================== Initialization ====================
  // These are called once on login by AppModule.onLogin()

  function initialize() {
    if (initialized) return;
    initialized = true;

    cacheDomRefs();
    setupMap();
    bindEvents();
    loadInitialData();
  }

  // Called when the FAA/OpenSky tab is activated — reload from DB + resize map
  function onActivate() {
    if (map) {
      map.invalidateSize();
    }
    if (initialized) {
      // Reload flight data from database (user may have imported new data)
      loadFromDatabase();
    }
  }

  // ── Exports ─────────────────────────────────────────────────────────────
  return {
    initialize: initialize,
    onActivate: onActivate,
    setStatus: setStatus,
  };
})();

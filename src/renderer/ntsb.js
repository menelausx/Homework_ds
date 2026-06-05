// ==================== NTSB Accident Trend Analysis Module ====================

var NtsbModule = (function () {
  'use strict';

  var initialized = false;
  var map = null;
  var geoLayer = null;
  var refreshTimer = null;
  var optionYears = { min: null, max: null };

  var state = {
    loading: false,
    pendingLoad: false,
    lastFiltersKey: '',
  };

  var COLORS = {
    cyan: '#39c5cf',
    blue: '#58a6ff',
    red: '#e06c75',
    orange: '#d2991d',
    green: '#3fb950',
    purple: '#bc8cff',
    muted: '#6e7681',
    grid: '#30363d',
    text: '#c9d1d9',
  };

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var els = {};

  function cacheDomRefs() {
    els.status = $('#ntsb-status-text');
    els.yearFrom = $('#ntsb-year-from');
    els.yearTo = $('#ntsb-year-to');
    els.country = $('#ntsb-country');
    els.state = $('#ntsb-state');
    els.severity = $('#ntsb-severity');
    els.acftCategory = $('#ntsb-acft-category');
    els.damage = $('#ntsb-damage');
    els.refresh = $('#btn-ntsb-refresh');
    els.reset = $('#btn-ntsb-reset');

    els.kpiTotal = $('#ntsb-kpi-total');
    els.kpiFatal = $('#ntsb-kpi-fatal');
    els.kpiFatalRate = $('#ntsb-kpi-fatal-rate');
    els.kpiAircraft = $('#ntsb-kpi-aircraft');
    els.kpiGeo = $('#ntsb-kpi-geo');
    els.kpiNarrative = $('#ntsb-kpi-narrative');
    els.kpiRegion = $('#ntsb-kpi-region');

    els.yearlyChart = $('#ntsb-yearly-chart');
    els.severityChart = $('#ntsb-severity-chart');
    els.weatherChart = $('#ntsb-weather-chart');
    els.findingChart = $('#ntsb-finding-chart');
    els.categoryList = $('#ntsb-category-list');
    els.makeList = $('#ntsb-make-list');
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function formatInt(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  function formatPct(value) {
    return ((Number(value || 0)) * 100).toFixed(1) + '%';
  }

  function severityLabel(value) {
    var map = {
      FATL: '致命',
      SERS: '严重',
      MINR: '轻伤',
      NONE: '无伤',
      UNKNOWN: '未知',
    };
    return map[String(value || '').toUpperCase()] || value || '未知';
  }

  function safeText(value) {
    return value == null || value === '' ? '未知' : String(value);
  }

  function fillSelect(select, options, placeholder) {
    if (!select) return;
    select.innerHTML = '';

    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder || '全部';
    select.appendChild(empty);

    for (var i = 0; i < options.length; i++) {
      var item = options[i];
      var opt = document.createElement('option');
      opt.value = item.value;
      opt.textContent = item.value + (item.count != null ? ' (' + formatInt(item.count) + ')' : '');
      select.appendChild(opt);
    }
  }

  function getFilters() {
    return {
      yearFrom: els.yearFrom && els.yearFrom.value ? Number(els.yearFrom.value) : '',
      yearTo: els.yearTo && els.yearTo.value ? Number(els.yearTo.value) : '',
      country: els.country ? els.country.value : '',
      state: els.state ? els.state.value : '',
      severity: els.severity ? els.severity.value : '',
      acftCategory: els.acftCategory ? els.acftCategory.value : '',
      damage: els.damage ? els.damage.value : '',
    };
  }

  function scheduleLoad() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadDashboard, 180);
  }

  function setupMap() {
    if (map || typeof L === 'undefined') return;

    map = L.map('ntsb-map', {
      center: [39.5, -98.0],
      zoom: 4,
      minZoom: 2,
      maxZoom: 12,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
      detectRetina: false,
    }).addTo(map);

    geoLayer = L.layerGroup().addTo(map);
  }

  async function loadOptions() {
    var options = await window.electronAPI.getNtsbFilterOptions();
    optionYears = options.years || { min: null, max: null };

    if (els.yearFrom && optionYears.min != null) {
      els.yearFrom.value = optionYears.min;
      els.yearFrom.min = optionYears.min;
      els.yearFrom.max = optionYears.max || optionYears.min;
    }
    if (els.yearTo && optionYears.max != null) {
      els.yearTo.value = optionYears.max;
      els.yearTo.min = optionYears.min || optionYears.max;
      els.yearTo.max = optionYears.max;
    }

    fillSelect(els.country, options.countries || [], '全部国家');
    fillSelect(els.state, options.states || [], '全部州/地区');
    fillSelect(els.severity, options.severities || [], '全部严重度');
    fillSelect(els.acftCategory, options.aircraftCategories || [], '全部飞机类别');
    fillSelect(els.damage, options.damages || [], '全部损坏程度');
  }

  async function loadDashboard() {
    if (state.loading) {
      state.pendingLoad = true;
      return;
    }
    var filters = getFilters();
    var key = JSON.stringify(filters);
    state.lastFiltersKey = key;
    state.loading = true;
    setStatus('正在加载聚合数据...');
    if (els.refresh) els.refresh.disabled = true;

    try {
      var results = await Promise.all([
        window.electronAPI.getNtsbOverview(filters),
        window.electronAPI.getNtsbYearlyTrend(filters),
        window.electronAPI.getNtsbSeverityDistribution(filters),
        window.electronAPI.getNtsbGeoAggregation(filters),
        window.electronAPI.getNtsbAircraftBreakdown(filters),
        window.electronAPI.getNtsbWeatherBreakdown(filters),
        window.electronAPI.getNtsbFindingBreakdown(filters),
      ]);

      if (state.lastFiltersKey !== key) return;

      renderOverview(results[0]);
      renderYearlyChart(results[1] || []);
      renderSeverityChart(results[2] || []);
      renderGeoAggregation(results[3] || []);
      renderAircraftBreakdown(results[4] || {});
      renderWeatherBreakdown(results[5] || {});
      renderFindingBreakdown(results[6] || {});
      setStatus('已加载 ' + formatInt(results[0].totalEvents || 0) + ' 条事故/事件聚合');
    } catch (err) {
      console.error('NTSB dashboard load error:', err);
      setStatus('加载失败: ' + err.message);
    } finally {
      state.loading = false;
      if (els.refresh) els.refresh.disabled = false;
      if (state.pendingLoad) {
        state.pendingLoad = false;
        loadDashboard();
      }
    }
  }

  function renderOverview(data) {
    data = data || {};
    if (els.kpiTotal) els.kpiTotal.textContent = formatInt(data.totalEvents);
    if (els.kpiFatal) els.kpiFatal.textContent = formatInt(data.fatalEvents);
    if (els.kpiFatalRate) els.kpiFatalRate.textContent = formatPct(data.fatalRate);
    if (els.kpiAircraft) els.kpiAircraft.textContent = formatInt(data.aircraftCount);
    if (els.kpiGeo) els.kpiGeo.textContent = formatInt(data.geoEventCount);
    if (els.kpiNarrative) els.kpiNarrative.textContent = formatInt(data.narrativeEventCount);
    if (els.kpiRegion) {
      var region = data.topRegion;
      els.kpiRegion.textContent = region
        ? [region.country, region.state].filter(Boolean).join(' / ') + ' ' + formatInt(region.count)
        : '--';
    }
  }

  function clearChart(el, emptyText) {
    if (!el) return false;
    el.innerHTML = '';
    if (emptyText) {
      var empty = document.createElement('div');
      empty.className = 'ntsb-empty';
      empty.textContent = emptyText;
      el.appendChild(empty);
      return true;
    }
    return false;
  }

  function svgEl(name, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', name);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function renderYearlyChart(rows) {
    if (!rows.length) {
      clearChart(els.yearlyChart, '暂无年度趋势数据');
      return;
    }

    clearChart(els.yearlyChart);
    var width = Math.max(720, els.yearlyChart.clientWidth || 720);
    var height = Math.max(250, els.yearlyChart.clientHeight || 250);
    var pad = { l: 44, r: 20, t: 16, b: 32 };
    var plotW = width - pad.l - pad.r;
    var plotH = height - pad.t - pad.b;
    var maxTotal = Math.max.apply(null, rows.map(function (r) { return r.total || 0; })) || 1;
    var maxFatal = Math.max.apply(null, rows.map(function (r) { return r.fatal || 0; })) || 1;
    var barW = Math.max(3, plotW / rows.length * 0.62);
    var step = plotW / Math.max(1, rows.length - 1);

    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, class: 'ntsb-svg' });
    for (var i = 0; i <= 4; i++) {
      var y = pad.t + plotH - plotH * i / 4;
      svg.appendChild(svgEl('line', { x1: pad.l, y1: y, x2: width - pad.r, y2: y, class: 'ntsb-grid-line' }));
      var label = svgEl('text', { x: pad.l - 8, y: y + 4, class: 'ntsb-axis-label', 'text-anchor': 'end' });
      label.textContent = Math.round(maxTotal * i / 4);
      svg.appendChild(label);
    }

    var fatalPoints = [];
    rows.forEach(function (row, index) {
      var x = pad.l + (rows.length === 1 ? plotW / 2 : step * index);
      var barH = plotH * (row.total || 0) / maxTotal;
      var y = pad.t + plotH - barH;
      var rect = svgEl('rect', {
        x: x - barW / 2,
        y: y,
        width: barW,
        height: Math.max(1, barH),
        rx: 2,
        class: 'ntsb-trend-bar',
        'data-year': row.year,
      });
      rect.addEventListener('click', function () {
        setYearFilter(row.year);
      });
      svg.appendChild(rect);

      var fy = pad.t + plotH - plotH * (row.fatal || 0) / Math.max(maxFatal, 1);
      fatalPoints.push(x + ',' + fy);

      if (index % Math.ceil(rows.length / 10) === 0 || index === rows.length - 1) {
        var yearLabel = svgEl('text', { x: x, y: height - 9, class: 'ntsb-axis-label', 'text-anchor': 'middle' });
        yearLabel.textContent = row.year;
        svg.appendChild(yearLabel);
      }
    });

    svg.appendChild(svgEl('polyline', {
      points: fatalPoints.join(' '),
      class: 'ntsb-fatal-line',
      fill: 'none',
    }));

    rows.forEach(function (row, index) {
      var x = pad.l + (rows.length === 1 ? plotW / 2 : step * index);
      var y = pad.t + plotH - plotH * (row.fatal || 0) / Math.max(maxFatal, 1);
      var dot = svgEl('circle', { cx: x, cy: y, r: 3, class: 'ntsb-fatal-dot' });
      dot.addEventListener('click', function () {
        setYearFilter(row.year);
      });
      svg.appendChild(dot);
    });

    var legend = svgEl('text', { x: width - pad.r, y: 14, class: 'ntsb-legend-label', 'text-anchor': 'end' });
    legend.textContent = '柱: 总量  线: 致命';
    svg.appendChild(legend);
    els.yearlyChart.appendChild(svg);
  }

  function renderSeverityChart(rows) {
    renderBars(els.severityChart, rows.map(function (row) {
      return { label: severityLabel(row.severity), raw: row.severity, count: row.count };
    }), {
      empty: '暂无严重度数据',
      color: COLORS.red,
      onClick: function (row) {
        if (els.severity) {
          els.severity.value = row.raw || '';
          scheduleLoad();
        }
      },
    });
  }

  function renderWeatherBreakdown(data) {
    renderBars(els.weatherChart, (data.light || []).map(function (row) {
      var fatalRate = row.count ? row.fatalCount / row.count : 0;
      return {
        label: safeText(row.label),
        count: row.count,
        meta: formatPct(fatalRate),
      };
    }), {
      empty: '暂无光照条件数据',
      color: COLORS.blue,
    });
  }

  function renderFindingBreakdown(data) {
    renderBars(els.findingChart, (data.categories || []).map(function (row) {
      return { label: row.label, count: row.count };
    }), {
      empty: '暂无原因发现数据',
      color: COLORS.purple,
    });
  }

  function renderBars(container, rows, opts) {
    opts = opts || {};
    if (!rows.length) {
      clearChart(container, opts.empty || '暂无数据');
      return;
    }

    clearChart(container);
    var max = Math.max.apply(null, rows.map(function (r) { return r.count || 0; })) || 1;
    var list = document.createElement('div');
    list.className = 'ntsb-bar-list';

    rows.forEach(function (row) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'ntsb-bar-row';
      if (!opts.onClick) item.disabled = true;
      item.addEventListener('click', function () {
        if (opts.onClick) opts.onClick(row);
      });

      var top = document.createElement('div');
      top.className = 'ntsb-bar-row-top';
      var label = document.createElement('span');
      label.textContent = safeText(row.label);
      var value = document.createElement('strong');
      value.textContent = formatInt(row.count) + (row.meta ? ' / ' + row.meta : '');
      top.appendChild(label);
      top.appendChild(value);

      var track = document.createElement('div');
      track.className = 'ntsb-bar-track';
      var fill = document.createElement('div');
      fill.className = 'ntsb-bar-fill';
      fill.style.width = Math.max(2, (row.count || 0) / max * 100) + '%';
      fill.style.background = opts.color || COLORS.cyan;
      track.appendChild(fill);

      item.appendChild(top);
      item.appendChild(track);
      list.appendChild(item);
    });

    container.appendChild(list);
  }

  function renderAircraftBreakdown(data) {
    renderCompactList(els.categoryList, data.categories || [], function (row) {
      if (els.acftCategory) {
        els.acftCategory.value = row.label === 'UNKNOWN' ? '' : row.label;
        scheduleLoad();
      }
    });
    renderCompactList(els.makeList, data.makes || []);
  }

  function renderCompactList(container, rows, onClick) {
    if (!container) return;
    container.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'ntsb-empty compact';
      empty.textContent = '暂无数据';
      container.appendChild(empty);
      return;
    }

    var max = Math.max.apply(null, rows.map(function (r) { return r.count || 0; })) || 1;
    rows.forEach(function (row) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'ntsb-list-row';
      if (!onClick) item.disabled = true;
      item.addEventListener('click', function () {
        if (onClick) onClick(row);
      });

      var label = document.createElement('span');
      label.textContent = safeText(row.label);
      var value = document.createElement('strong');
      value.textContent = formatInt(row.count);
      var bar = document.createElement('i');
      bar.style.width = Math.max(3, (row.count || 0) / max * 100) + '%';

      item.appendChild(label);
      item.appendChild(value);
      item.appendChild(bar);
      container.appendChild(item);
    });
  }

  function renderGeoAggregation(rows) {
    if (!map || !geoLayer) return;
    geoLayer.clearLayers();

    if (!rows.length) {
      return;
    }

    var max = Math.max.apply(null, rows.map(function (r) { return r.count || 0; })) || 1;
    var bounds = [];

    rows.forEach(function (row) {
      var count = row.count || 0;
      var fatalRate = count ? (row.fatalCount || 0) / count : 0;
      var radius = 5 + Math.sqrt(count / max) * 22;
      var color = fatalRate > 0.28 ? COLORS.red : fatalRate > 0.12 ? COLORS.orange : COLORS.cyan;
      var marker = L.circleMarker([row.lat, row.lng], {
        radius: radius,
        color: color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.34,
      });

      marker.bindTooltip(
        [row.country, row.state].filter(Boolean).join(' / ') +
        '<br>事故: ' + formatInt(count) +
        '<br>致命: ' + formatInt(row.fatalCount || 0),
        { sticky: true }
      );
      marker.on('click', function () {
        if (els.country && row.country && row.country !== 'UNKNOWN') els.country.value = row.country;
        if (els.state && row.state) els.state.value = row.state;
        scheduleLoad();
      });
      geoLayer.addLayer(marker);
      bounds.push([row.lat, row.lng]);
    });

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 6 });
    }
  }

  function setYearFilter(year) {
    if (!year) return;
    if (els.yearFrom) els.yearFrom.value = year;
    if (els.yearTo) els.yearTo.value = year;
    scheduleLoad();
  }

  function resetFilters() {
    if (els.yearFrom) els.yearFrom.value = optionYears.min || '';
    if (els.yearTo) els.yearTo.value = optionYears.max || '';
    [els.country, els.state, els.severity, els.acftCategory, els.damage].forEach(function (select) {
      if (select) select.value = '';
    });
    loadDashboard();
  }

  function bindEvents() {
    [els.yearFrom, els.yearTo, els.country, els.state, els.severity, els.acftCategory, els.damage].forEach(function (el) {
      if (el) {
        el.addEventListener('change', scheduleLoad);
      }
    });

    if (els.refresh) els.refresh.addEventListener('click', loadDashboard);
    if (els.reset) els.reset.addEventListener('click', resetFilters);

    window.addEventListener('resize', function () {
      if (map) map.invalidateSize();
      scheduleRenderOnly();
    });
  }

  function scheduleRenderOnly() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadDashboard, 240);
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;

    cacheDomRefs();
    setupMap();
    bindEvents();

    try {
      setStatus('正在读取筛选项...');
      await loadOptions();
      await loadDashboard();
    } catch (err) {
      console.error('NTSB initialization error:', err);
      setStatus('初始化失败: ' + err.message);
    }
  }

  function onActivate() {
    if (!initialized) {
      initialize();
      return;
    }
    if (map) {
      setTimeout(function () {
        map.invalidateSize();
        loadDashboard();
      }, 0);
    }
  }

  return {
    initialize: initialize,
    onActivate: onActivate,
  };
})();

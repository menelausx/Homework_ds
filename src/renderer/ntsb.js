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
    optionsLoading: false,
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

  var DISPLAY_LABELS = {
    severity: {
      FATL: '致命',
      SERS: '严重',
      MINR: '轻伤',
      NONE: '无伤',
      UNKNOWN: '未知',
    },
    damage: {
      DEST: '彻底毁坏',
      DESTROYED: '彻底毁坏',
      SUBS: '严重损坏',
      SUBSTANTIAL: '严重损坏',
      MINR: '轻微损坏',
      MINOR: '轻微损坏',
      NONE: '无损坏',
      UNKNOWN: '未知',
      UNK: '未知',
    },
    acftCategory: {
      AIRPLANE: '飞机',
      HELICOPTER: '直升机',
      GLIDER: '滑翔机',
      BALLOON: '气球',
      GYROCRAFT: '旋翼机',
      ULTRALIGHT: '超轻型航空器',
      'POWERED PARACHUTE': '动力伞',
      'WEIGHT-SHIFT': '重心转移飞行器',
      'WEIGHT SHIFT': '重心转移飞行器',
      UNKNOWN: '未知',
    },
    light: {
      DAYL: '白天',
      DAYLIGHT: '白天',
      DARK: '夜间',
      NIGHT: '夜间',
      NITE: '夜间',
      NR: '夜间跑道灯光',
      NBRT: '夜间明亮',
      DAWN: '黎明',
      DUSK: '黄昏',
      NDRK: '夜间无照明',
      'DARK NIGHT': '夜间无照明',
      'DARKNIGHT': '夜间无照明',
      UNKNOWN: '未知',
      UNK: '未知',
    },
    weather: {
      VMC: '目视气象条件',
      IMC: '仪表气象条件',
      UNKNOWN: '未知',
      UNK: '未知',
    },
    country: {
      A1: '国际水域/特殊地区',
      AE: '阿联酋',
      AF: '阿富汗',
      AI: '安圭拉',
      AL: '阿尔巴尼亚',
      AM: '亚美尼亚',
      AO: '安哥拉',
      AQ: '南极洲',
      AR: '阿根廷',
      AT: '奥地利',
      AU: '澳大利亚',
      AY: '南极洲',
      BA: '波斯尼亚和黑塞哥维那',
      BB: '巴巴多斯',
      BD: '孟加拉国',
      BE: '比利时',
      BG: '保加利亚',
      BH: '巴林',
      BJ: '贝宁',
      BM: '百慕大',
      BO: '玻利维亚',
      BR: '巴西',
      BS: '巴哈马',
      BW: '博茨瓦纳',
      BY: '白俄罗斯',
      BZ: '伯利兹',
      CA: '加拿大',
      CD: '刚果民主共和国',
      CH: '瑞士',
      CI: '科特迪瓦',
      CL: '智利',
      CM: '喀麦隆',
      CN: '中国',
      CO: '哥伦比亚',
      CQ: '北马里亚纳群岛',
      CR: '哥斯达黎加',
      CU: '古巴',
      CY: '塞浦路斯',
      CZ: '捷克',
      DE: '德国',
      DK: '丹麦',
      DM: '多米尼克',
      DO: '多米尼加共和国',
      DZ: '阿尔及利亚',
      EC: '厄瓜多尔',
      EE: '爱沙尼亚',
      EG: '埃及',
      ES: '西班牙',
      ET: '埃塞俄比亚',
      FI: '芬兰',
      FJ: '斐济',
      FM: '密克罗尼西亚联邦',
      FR: '法国',
      GA: '加蓬',
      GB: '英国',
      GE: '格鲁吉亚',
      GF: '法属圭亚那',
      GH: '加纳',
      GL: '格陵兰',
      GN: '几内亚',
      GP: '瓜德罗普',
      GQ: '赤道几内亚',
      GR: '希腊',
      GT: '危地马拉',
      GY: '圭亚那',
      HK: '中国香港',
      HN: '洪都拉斯',
      HR: '克罗地亚',
      HT: '海地',
      HU: '匈牙利',
      ID: '印度尼西亚',
      IE: '爱尔兰',
      IL: '以色列',
      IM: '马恩岛',
      IN: '印度',
      IQ: '伊拉克',
      IR: '伊朗',
      IS: '冰岛',
      IT: '意大利',
      JE: '泽西',
      JM: '牙买加',
      JO: '约旦',
      JP: '日本',
      KE: '肯尼亚',
      KG: '吉尔吉斯斯坦',
      KI: '基里巴斯',
      KM: '科摩罗',
      KN: '圣基茨和尼维斯',
      KP: '朝鲜',
      KR: '韩国',
      KW: '科威特',
      KY: '开曼群岛',
      KZ: '哈萨克斯坦',
      LA: '老挝',
      LB: '黎巴嫩',
      LK: '斯里兰卡',
      LR: '利比里亚',
      LT: '立陶宛',
      LU: '卢森堡',
      LV: '拉脱维亚',
      LY: '利比亚',
      MA: '摩洛哥',
      MD: '摩尔多瓦',
      MG: '马达加斯加',
      MH: '马绍尔群岛',
      MK: '北马其顿',
      ML: '马里',
      MM: '缅甸',
      MN: '蒙古',
      MQ: '马提尼克',
      MR: '毛里塔尼亚',
      MT: '马耳他',
      MV: '马尔代夫',
      MX: '墨西哥',
      MY: '马来西亚',
      MZ: '莫桑比克',
      NA: '纳米比亚',
      NC: '新喀里多尼亚',
      NE: '尼日尔',
      NG: '尼日利亚',
      NI: '尼加拉瓜',
      NL: '荷兰',
      NO: '挪威',
      NP: '尼泊尔',
      NR: '瑙鲁',
      NT: '荷属安的列斯',
      NZ: '新西兰',
      OM: '阿曼',
      PA: '巴拿马',
      PE: '秘鲁',
      PF: '法属波利尼西亚',
      PG: '巴布亚新几内亚',
      PH: '菲律宾',
      PK: '巴基斯坦',
      PL: '波兰',
      PM: '圣皮埃尔和密克隆',
      PT: '葡萄牙',
      PW: '帕劳',
      PY: '巴拉圭',
      QA: '卡塔尔',
      RE: '留尼汪',
      RO: '罗马尼亚',
      RS: '塞尔维亚',
      RU: '俄罗斯',
      RW: '卢旺达',
      SA: '沙特阿拉伯',
      SB: '所罗门群岛',
      SC: '塞舌尔',
      SD: '苏丹',
      SE: '瑞典',
      SG: '新加坡',
      SI: '斯洛文尼亚',
      SK: '斯洛伐克',
      SN: '塞内加尔',
      SO: '索马里',
      SR: '苏里南',
      ST: '圣多美和普林西比',
      SV: '萨尔瓦多',
      TC: '特克斯和凯科斯群岛',
      TD: '乍得',
      TH: '泰国',
      TJ: '塔吉克斯坦',
      TN: '突尼斯',
      TR: '土耳其',
      TT: '特立尼达和多巴哥',
      TW: '中国台湾',
      TZ: '坦桑尼亚',
      UA: '乌克兰',
      UG: '乌干达',
      US: '美国',
      USA: '美国',
      'UNITED STATES': '美国',
      UY: '乌拉圭',
      UZ: '乌兹别克斯坦',
      VC: '圣文森特和格林纳丁斯',
      VE: '委内瑞拉',
      VG: '英属维尔京群岛',
      VN: '越南',
      VU: '瓦努阿图',
      WF: '瓦利斯和富图纳',
      WZ: '特殊/未知地区',
      XK: '科索沃',
      YE: '也门',
      ZA: '南非',
      ZW: '津巴布韦',
      CANADA: '加拿大',
      MEXICO: '墨西哥',
      UNKNOWN: '未知',
    },
    state: {
      AL: '阿拉巴马州',
      AK: '阿拉斯加州',
      AZ: '亚利桑那州',
      AR: '阿肯色州',
      CA: '加利福尼亚州',
      CO: '科罗拉多州',
      CT: '康涅狄格州',
      DE: '特拉华州',
      FL: '佛罗里达州',
      GA: '佐治亚州',
      HI: '夏威夷州',
      ID: '爱达荷州',
      IL: '伊利诺伊州',
      IN: '印第安纳州',
      IA: '艾奥瓦州',
      KS: '堪萨斯州',
      KY: '肯塔基州',
      LA: '路易斯安那州',
      ME: '缅因州',
      MD: '马里兰州',
      MA: '马萨诸塞州',
      MI: '密歇根州',
      MN: '明尼苏达州',
      MS: '密西西比州',
      MO: '密苏里州',
      MT: '蒙大拿州',
      NE: '内布拉斯加州',
      NV: '内华达州',
      NH: '新罕布什尔州',
      NJ: '新泽西州',
      NM: '新墨西哥州',
      NY: '纽约州',
      NC: '北卡罗来纳州',
      ND: '北达科他州',
      OH: '俄亥俄州',
      OK: '俄克拉荷马州',
      OR: '俄勒冈州',
      PA: '宾夕法尼亚州',
      RI: '罗得岛州',
      SC: '南卡罗来纳州',
      SD: '南达科他州',
      TN: '田纳西州',
      TX: '得克萨斯州',
      UT: '犹他州',
      VT: '佛蒙特州',
      VA: '弗吉尼亚州',
      WA: '华盛顿州',
      WV: '西弗吉尼亚州',
      WI: '威斯康星州',
      WY: '怀俄明州',
      DC: '哥伦比亚特区',
      AS: '美属萨摩亚',
      GU: '关岛',
      MP: '北马里亚纳群岛',
      PR: '波多黎各',
      VI: '美属维尔京群岛',
      UM: '美国本土外小岛屿',
      OF: '境外',
      AO: '大西洋',
      PO: '太平洋',
      GM: '墨西哥湾',
      CB: '加勒比海',
      UNKNOWN: '未知',
      UNK: '未知',
    },
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
    return displayLabel('severity', value);
  }

  function safeText(value) {
    return value == null || value === '' ? '未知' : String(value);
  }

  function displayLabel(field, value) {
    var text = safeText(value);
    var key = String(text).trim().toUpperCase();
    var fieldMap = DISPLAY_LABELS[field] || {};
    return fieldMap[key] || text;
  }

  function fillSelect(select, options, placeholder, field) {
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
      opt.textContent = displayLabel(field, item.value) + (item.count != null ? ' (' + formatInt(item.count) + ')' : '');
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
    };
  }

  function scheduleLoad() {
    if (refreshTimer) clearTimeout(refreshTimer);
    state.lastFiltersKey = JSON.stringify(getFilters());
    refreshTimer = setTimeout(loadDashboard, 350);
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

  function hasOption(select, value) {
    if (!select || value == null || value === '') return false;
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === String(value)) return true;
    }
    return false;
  }

  async function loadOptions(preserveSelection) {
    var previous = preserveSelection ? getFilters() : {};
    var options = await window.electronAPI.getNtsbFilterOptions();
    optionYears = options.years || { min: null, max: null };

    if (els.yearFrom && optionYears.min != null) {
      els.yearFrom.min = optionYears.min;
      els.yearFrom.max = optionYears.max || optionYears.min;
      els.yearFrom.value = previous.yearFrom >= optionYears.min && previous.yearFrom <= optionYears.max
        ? previous.yearFrom
        : optionYears.min;
    }
    if (els.yearTo && optionYears.max != null) {
      els.yearTo.min = optionYears.min || optionYears.max;
      els.yearTo.max = optionYears.max;
      els.yearTo.value = previous.yearTo >= optionYears.min && previous.yearTo <= optionYears.max
        ? previous.yearTo
        : optionYears.max;
    }

    fillSelect(els.country, options.countries || [], '全部国家/地区', 'country');
    fillSelect(els.state, options.states || [], '全部州/地区', 'state');
    fillSelect(els.severity, options.severities || [], '全部严重度', 'severity');

    [
      [els.country, previous.country],
      [els.state, previous.state],
      [els.severity, previous.severity],
    ].forEach(function (entry) {
      if (hasOption(entry[0], entry[1])) entry[0].value = entry[1];
    });
  }

  async function refreshOptionsAndDashboard(preserveSelection) {
    if (state.optionsLoading) return;
    state.optionsLoading = true;
    try {
      setStatus('正在读取筛选项...');
      await loadOptions(preserveSelection);
      await loadDashboard();
    } finally {
      state.optionsLoading = false;
    }
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
        ? [displayLabel('country', region.country), displayLabel('state', region.state)].filter(Boolean).join(' / ') + ' ' + formatInt(region.count)
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
        label: displayLabel('light', row.label),
        raw: row.label,
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
    renderCompactList(els.categoryList, (data.categories || []).map(function (row) {
      return {
        label: displayLabel('acftCategory', row.label),
        count: row.count,
      };
    }));
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

    var validRows = rows.filter(function (row) {
      var lat = Number(row.lat);
      var lng = Number(row.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    });

    if (els.kpiGeo) {
      els.kpiGeo.textContent = formatInt(validRows.reduce(function (sum, row) {
        return sum + Number(row.count || 0);
      }, 0));
    }

    if (!validRows.length) {
      return;
    }

    var max = Math.max.apply(null, validRows.map(function (r) { return r.count || 0; })) || 1;
    var bounds = [];

    validRows.forEach(function (row) {
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
        [displayLabel('country', row.country), displayLabel('state', row.state)].filter(Boolean).join(' / ') +
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
    [els.country, els.state, els.severity].forEach(function (select) {
      if (select) select.value = '';
    });
    loadDashboard();
  }

  function bindEvents() {
    [els.yearFrom, els.yearTo, els.country, els.state, els.severity].forEach(function (el) {
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
      await refreshOptionsAndDashboard(false);
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
        refreshOptionsAndDashboard(true);
      }, 0);
    }
  }

  return {
    initialize: initialize,
    onActivate: onActivate,
  };
})();

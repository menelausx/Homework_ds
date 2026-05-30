// ==================== Data Import Module ====================
// Data source card management: list sources, download, parse, import, one-click update.

var ImportModule = (function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────────
  var moduleImport = document.getElementById('module-import');
  var cardGrid = document.getElementById('import-card-grid');
  var loadingOverlay = document.getElementById('loading-overlay');
  var loadingText = document.getElementById('loading-text');

  // ── Internal state ──────────────────────────────────────────────────────
  var sources = [];
  var initialized = false;

  // ── Utility ─────────────────────────────────────────────────────────────

  function showLoading(text) {
    if (!loadingOverlay || !loadingText) return;
    loadingText.textContent = text || '操作中...';
    loadingOverlay.style.display = '';
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(isoString) {
    if (!isoString) return '--';
    try {
      var d = new Date(isoString);
      return d.toLocaleString('zh-CN', {
        year: 'numeric',
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

  function formatTimestamp(text) {
    if (!text) return '--';
    // SQLite datetime: "YYYY-MM-DD HH:MM:SS"
    try {
      var parts = text.split(' ');
      if (parts.length >= 2) {
        return parts[0] + ' ' + parts[1].substring(0, 8);
      }
      return text;
    } catch (_) {
      return text;
    }
  }

  // Phase labels
  var PHASE_LABELS = {
    downloading: '正在下载...',
    parsing: '正在解析...',
    importing: '正在入库...',
    starting: '正在启动...',
    completed: '完成',
    failed: '失败',
  };

  // ── Render ──────────────────────────────────────────────────────────────

  function renderCards() {
    if (!cardGrid) return;

    if (!sources || sources.length === 0) {
      cardGrid.innerHTML =
        '<div class="import-empty">暂无可用数据源</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var phase = s.currentPhase;
      var phaseLabel = phase ? (PHASE_LABELS[phase] || phase) : null;
      var errorText = escapeHtml(s.error || '');

      html += '<div class="import-card" data-source-id="' + escapeHtml(s.sourceId) + '">';

      // Header
      html += '<div class="import-card-header">';
      html += '<h3 class="import-card-title">' + escapeHtml(s.name) + '</h3>';
      html += '<span class="import-card-badge">' + escapeHtml(s.sourceId) + '</span>';
      html += '</div>';

      // Body
      html += '<div class="import-card-body">';
      html += '<p class="import-card-desc">' + escapeHtml(s.description) + '</p>';

      // URL
      html += '<div class="import-card-field">';
      html += '<span class="import-card-label">数据来源</span>';
      html += '<a class="import-card-url" href="#" title="' + escapeHtml(s.url) + '">' + escapeHtml(s.url) + '</a>';
      html += '</div>';

      // Status
      html += '<div class="import-card-field">';
      html += '<span class="import-card-label">状态</span>';
      if (phaseLabel) {
        html += '<span class="import-card-status phase">' + escapeHtml(phaseLabel) + '</span>';
      } else if (errorText) {
        html += '<span class="import-card-status error">错误</span>';
      } else {
        html += '<span class="import-card-status ok">就绪</span>';
      }
      html += '</div>';

      // Stats grid
      html += '<div class="import-card-stats">';
      html += '<div class="import-card-stat">';
      html += '<span class="import-stat-label">最近下载</span>';
      html += '<span class="import-stat-value">' + formatTime(s.lastDownload) + '</span>';
      html += '</div>';
      html += '<div class="import-card-stat">';
      html += '<span class="import-stat-label">最近解析</span>';
      html += '<span class="import-stat-value">' + formatTimestamp(s.lastParse) + '</span>';
      html += '</div>';
      html += '<div class="import-card-stat">';
      html += '<span class="import-stat-label">最近入库</span>';
      html += '<span class="import-stat-value">' + formatTimestamp(s.lastImport) + '</span>';
      html += '</div>';
      html += '<div class="import-card-stat">';
      html += '<span class="import-stat-label">数据库记录数</span>';
      html += '<span class="import-stat-value count">' + (s.recordCount ? s.recordCount.toLocaleString() : '0') + '</span>';
      html += '</div>';
      html += '</div>';

      // Error
      if (errorText) {
        html += '<div class="import-card-error">';
        html += '<span class="import-error-icon">&#9888;</span>';
        html += '<span class="import-error-text">' + errorText + '</span>';
        html += '</div>';
      }
      html += '</div>';

      // Actions
      html += '<div class="import-card-actions">';
      html += '<button class="import-btn download" data-action="download" data-source="' +
        escapeHtml(s.sourceId) + '" ' + (phase ? 'disabled' : '') + '>下载</button>';
      html += '<button class="import-btn parse" data-action="parse" data-source="' +
        escapeHtml(s.sourceId) + '" ' + (phase ? 'disabled' : '') + '>解析</button>';
      html += '<button class="import-btn import" data-action="import" data-source="' +
        escapeHtml(s.sourceId) + '" ' + (phase ? 'disabled' : '') + '>入库</button>';
      html += '<button class="import-btn primary" data-action="updateAll" data-source="' +
        escapeHtml(s.sourceId) + '" ' + (phase ? 'disabled' : '') + '>一键更新</button>';
      html += '</div>';

      html += '</div>';
    }
    cardGrid.innerHTML = html;
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  async function doDownload(sourceId) {
    var card = cardGrid ? cardGrid.querySelector('[data-source-id="' + sourceId + '"]') : null;
    setCardPhase(sourceId, 'downloading');
    try {
      var result = await window.electronAPI.downloadDataSource(sourceId);
      if (result.success) {
        clearCardPhase(sourceId);
      } else {
        setCardError(sourceId, result.error || '下载失败');
      }
    } catch (err) {
      setCardError(sourceId, err.message);
    }
    await refreshSources();
  }

  async function doParse(sourceId) {
    setCardPhase(sourceId, 'parsing');
    try {
      var result = await window.electronAPI.parseDataSource(sourceId);
      if (result.success) {
        clearCardPhase(sourceId);
      } else {
        setCardError(sourceId, result.error || '解析失败');
      }
    } catch (err) {
      setCardError(sourceId, err.message);
    }
    await refreshSources();
  }

  async function doImport(sourceId) {
    setCardPhase(sourceId, 'importing');
    try {
      var result = await window.electronAPI.importDataSource(sourceId);
      if (result.success) {
        clearCardPhase(sourceId);
      } else {
        setCardError(sourceId, result.error || '入库失败');
      }
    } catch (err) {
      setCardError(sourceId, err.message);
    }
    await refreshSources();
  }

  async function doUpdateAll(sourceId) {
    setCardPhase(sourceId, 'downloading');
    showLoading('正在执行一键更新...');
    try {
      var result = await window.electronAPI.updateAllDataSource(sourceId);
      if (result.success) {
        clearCardPhase(sourceId);
        showNotification(sourceId, '一键更新完成');
      } else {
        setCardError(sourceId, result.error || '更新失败');
      }
    } catch (err) {
      setCardError(sourceId, err.message);
    }
    hideLoading();
    await refreshSources();
  }

  // ── Card state helpers ──────────────────────────────────────────────────

  function setCardPhase(sourceId, phase) {
    // Mark the card as being in a phase
    var idx = findSourceIndex(sourceId);
    if (idx >= 0) {
      sources[idx].currentPhase = phase;
      sources[idx].error = null;
    }
    renderCards();
  }

  function clearCardPhase(sourceId) {
    var idx = findSourceIndex(sourceId);
    if (idx >= 0) {
      sources[idx].currentPhase = null;
      sources[idx].error = null;
    }
    renderCards();
  }

  function setCardError(sourceId, errorMsg) {
    var idx = findSourceIndex(sourceId);
    if (idx >= 0) {
      sources[idx].currentPhase = null;
      sources[idx].error = errorMsg;
    }
    renderCards();
  }

  function findSourceIndex(sourceId) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].sourceId === sourceId) return i;
    }
    return -1;
  }

  function showNotification(sourceId, message) {
    // Use the app-level status bar if available
    if (typeof AppModule !== 'undefined' && AppModule.setStatus) {
      AppModule.setStatus('ok', message);
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────

  async function refreshSources() {
    try {
      var list = await window.electronAPI.listDataSources();
      sources = list || [];
      renderCards();
    } catch (err) {
      console.error('ImportModule: refreshSources error:', err);
      if (cardGrid) {
        cardGrid.innerHTML =
          '<div class="import-empty">加载数据源失败: ' + escapeHtml(err.message) + '</div>';
      }
    }
  }

  // ── Event delegation ────────────────────────────────────────────────────

  if (cardGrid) {
    cardGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('.import-btn');
      if (!btn || btn.disabled) return;

      var action = btn.getAttribute('data-action');
      var sourceId = btn.getAttribute('data-source');
      if (!sourceId) return;

      if (action === 'download') {
        doDownload(sourceId);
      } else if (action === 'parse') {
        doParse(sourceId);
      } else if (action === 'import') {
        doImport(sourceId);
      } else if (action === 'updateAll') {
        doUpdateAll(sourceId);
      }
    });
  }

  // ── Bind toolbar refresh button ──────────────────────────────────────────

  var btnRefresh = document.getElementById('btn-import-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', function () {
      refreshSources();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  function onActivate() {
    refreshSources();
  }

  return {
    onActivate: onActivate,
    refreshSources: refreshSources,
  };
})();

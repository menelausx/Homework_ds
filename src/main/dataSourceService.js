// Central registry for all data sources.
// Each data source must export: sourceId, name, description, url, download(), parse(), importToDatabase(), updateAll(), getStatus(), getCacheFiles()

const fs = require('fs');
const openskyDataSource = require('./openskyDataSource');
const faaDataSource = require('./faaDataSource');
const ntsbDataSource = require('./ntsbDataSource');
const cacheService = require('./cacheService');

// Registry: sourceId -> data source module
const registry = new Map();
registry.set(openskyDataSource.sourceId, openskyDataSource);
registry.set(faaDataSource.sourceId, faaDataSource);
registry.set(ntsbDataSource.sourceId, ntsbDataSource);

// Track in-memory errors per source (cleared on next successful operation)
const sourceErrors = new Map();
// Track in-progress phases per source
const sourcePhases = new Map();

function publicError(err) {
  return err && typeof err.code === 'string' ? err.code : 'DATA_SOURCE_OPERATION_FAILED';
}

function listSources() {
  const result = [];
  registry.forEach(function (ds) {
    const status = ds.getStatus();
    result.push({
      sourceId: ds.sourceId,
      name: ds.name,
      description: ds.description,
      url: ds.url,
      lastDownload: status.lastDownload || null,
      lastParse: status.lastParse || null,
      lastImport: status.lastImport || null,
      recordCount: status.recordCount || 0,
      error: sourceErrors.get(ds.sourceId) || null,
      currentPhase: sourcePhases.get(ds.sourceId) || null,
    });
  });
  return result;
}

function wrapAction(sourceId, actionName, actionFn) {
  return async function () {
    // Clear previous error for this source
    sourceErrors.delete(sourceId);
    try {
      sourcePhases.set(sourceId, actionName);
      const result = await actionFn();
      sourcePhases.delete(sourceId);
      return result;
    } catch (err) {
      sourcePhases.delete(sourceId);
      const code = publicError(err);
      sourceErrors.set(sourceId, code);
      console.error('[dataSourceService] ' + sourceId + '.' + actionName + ' failed:', code);
      return { success: false, error: code };
    }
  };
}

function cleanCacheForSource(sourceId) {
  const ds = registry.get(sourceId);
  if (!ds || !ds.getCacheFiles) return;
  const cacheFiles = ds.getCacheFiles();
  if (!cacheFiles || cacheFiles.length === 0) return;

  for (let i = 0; i < cacheFiles.length; i++) {
    try {
      const cachePath = cacheService.getDataFilePath(cacheFiles[i]);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        console.log('[dataSourceService] Cleaned cache for ' + sourceId + ': ' + cachePath);
      }
    } catch (err) {
      console.warn('[dataSourceService] Failed to clean cache for ' + sourceId + ': ' + cacheFiles[i] + ' - ' + err.message);
    }
  }
}

function wrapUpdateAll(sourceId, ds) {
  return async function () {
    sourceErrors.delete(sourceId);
    try {
      sourcePhases.set(sourceId, 'starting');
      const result = await ds.updateAll();
      sourcePhases.delete(sourceId);
      if (!result.success) {
        sourceErrors.set(sourceId, result.error);
      } else {
        cleanCacheForSource(sourceId);
      }
      return result;
    } catch (err) {
      sourcePhases.delete(sourceId);
      const code = publicError(err);
      sourceErrors.set(sourceId, code);
      console.error('[dataSourceService] ' + sourceId + '.updateAll failed:', code);
      return { success: false, error: code, phases: ['failed'] };
    }
  };
}

function download(sourceId) {
  const ds = registry.get(sourceId);
  if (!ds) {
    return Promise.resolve({ success: false, error: 'Unknown source: ' + sourceId });
  }
  return wrapAction(sourceId, 'downloading', function () { return ds.download(); })();
}

function parse(sourceId) {
  const ds = registry.get(sourceId);
  if (!ds) {
    return Promise.resolve({ success: false, error: 'Unknown source: ' + sourceId });
  }
  return wrapAction(sourceId, 'parsing', function () { return ds.parse(); })();
}

function importToDb(sourceId) {
  const ds = registry.get(sourceId);
  if (!ds) {
    return Promise.resolve({ success: false, error: 'Unknown source: ' + sourceId });
  }
  return wrapAction(sourceId, 'importing', async function () {
    const result = await ds.importToDatabase();
    if (result.success) {
      cleanCacheForSource(sourceId);
    }
    return result;
  })();
}

function updateAll(sourceId) {
  const ds = registry.get(sourceId);
  if (!ds) {
    return Promise.resolve({ success: false, error: 'Unknown source: ' + sourceId });
  }
  return wrapUpdateAll(sourceId, ds)();
}

function getStatus(sourceId) {
  const ds = registry.get(sourceId);
  if (!ds) {
    return { success: false, error: 'Unknown source: ' + sourceId };
  }
  return {
    success: true,
    sourceId: ds.sourceId,
    name: ds.name,
    description: ds.description,
    url: ds.url,
    status: ds.getStatus(),
    error: sourceErrors.get(sourceId) || null,
    currentPhase: sourcePhases.get(sourceId) || null,
  };
}

module.exports = {
  listSources,
  download,
  parse,
  importToDb,
  updateAll,
  getStatus,
};

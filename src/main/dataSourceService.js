// Central registry for all data sources.
// Each data source must export: sourceId, name, description, url, download(), parse(), importToDatabase(), updateAll(), getStatus()

const openskyDataSource = require('./openskyDataSource');
const faaDataSource = require('./faaDataSource');
const ntsbDataSource = require('./ntsbDataSource');

// Registry: sourceId -> data source module
const registry = new Map();
registry.set(openskyDataSource.sourceId, openskyDataSource);
registry.set(faaDataSource.sourceId, faaDataSource);
registry.set(ntsbDataSource.sourceId, ntsbDataSource);

// Track in-memory errors per source (cleared on next successful operation)
const sourceErrors = new Map();
// Track in-progress phases per source
const sourcePhases = new Map();

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
      sourceErrors.set(sourceId, err.message);
      console.error('[dataSourceService] Error in ' + sourceId + '.' + actionName + ':', err.message);
      return { success: false, error: err.message };
    }
  };
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
      }
      return result;
    } catch (err) {
      sourcePhases.delete(sourceId);
      sourceErrors.set(sourceId, err.message);
      console.error('[dataSourceService] Error in ' + sourceId + '.updateAll:', err.message);
      return { success: false, error: err.message, phases: ['failed'] };
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
  return wrapAction(sourceId, 'importing', function () { return ds.importToDatabase(); })();
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

const fs = require('fs');
const AdmZip = require('adm-zip');
const faaService = require('./faaService');
const cacheService = require('./cacheService');
const databaseService = require('./databaseService');

const SOURCE_ID = 'ntsb_aviation_accidents';
const ZIP_FILENAME = 'avall.zip';
const MDB_FILENAME = 'avall.mdb';
const NTSB_DOWNLOAD_URL = 'https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=C%3A%5Cavdata%5Cavall.zip';

const TARGET_TABLES = [
  'events',
  'aircraft',
  'narratives',
  'Findings',
  'Flight_Crew',
  'engines',
  'injury',
];

const TABLE_NAME_MAP = {
  events: 'ntsb_events',
  aircraft: 'ntsb_aircraft',
  narratives: 'ntsb_narratives',
  Findings: 'ntsb_findings',
  Flight_Crew: 'ntsb_flight_crew',
  engines: 'ntsb_engines',
  injury: 'ntsb_injury',
};

// ── Data Source Interface ──────────────────────────────────────────────────

const sourceId = SOURCE_ID;
const name = '美国民航事故调查数据集';
const description = '从 NTSB 下载 avall Access 数据库，导入事故事件、涉事飞机、叙述文本、原因发现、机组、发动机和伤害统计等核心表。';
const url = NTSB_DOWNLOAD_URL;

let mdbReaderClass = null;

async function loadMDBReader() {
  if (!mdbReaderClass) {
    const module = await import('mdb-reader');
    mdbReaderClass = module.default;
  }
  return mdbReaderClass;
}

function getZipPath() {
  return cacheService.getDataFilePath(ZIP_FILENAME);
}

function quoteIdentifier(identifier) {
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

function sqliteTypeForMdbType(type) {
  if (type === 'boolean' || type === 'byte' || type === 'integer' || type === 'long' || type === 'bigint') {
    return 'INTEGER';
  }
  if (type === 'currency' || type === 'float' || type === 'double' || type === 'numeric') {
    return 'REAL';
  }
  return 'TEXT';
}

function toSqlValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').substring(0, 19);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Buffer.isBuffer(value)) return value;
  return value;
}

function createIndexIfColumnExists(db, tableName, columns) {
  const existingColumns = db.prepare('PRAGMA table_info(' + quoteIdentifier(tableName) + ')').all()
    .map(function (col) { return col.name; });
  const usableColumns = columns.filter(function (col) { return existingColumns.includes(col); });
  if (usableColumns.length === 0) return;

  const indexName = 'idx_' + tableName + '_' + usableColumns.join('_').toLowerCase();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS ' + quoteIdentifier(indexName) +
    ' ON ' + quoteIdentifier(tableName) +
    '(' + usableColumns.map(quoteIdentifier).join(', ') + ')'
  ).run();
}

async function readMdb() {
  const zipPath = getZipPath();
  if (!fs.existsSync(zipPath)) {
    throw new Error('NTSB avall.zip 未找到，请先下载。');
  }

  const zip = new AdmZip(fs.readFileSync(zipPath));
  const mdbEntry = zip.getEntries().find(function (entry) {
    return entry.entryName.toLowerCase() === MDB_FILENAME;
  });

  if (!mdbEntry) {
    const availableFiles = zip.getEntries().map(function (entry) { return entry.entryName; }).join(', ');
    throw new Error('avall.mdb not found in zip. Available files: ' + availableFiles);
  }

  const MDBReader = await loadMDBReader();
  return {
    zipPath,
    reader: new MDBReader(zip.readFile(mdbEntry)),
  };
}

async function download() {
  const destPath = cacheService.getDataFilePath(ZIP_FILENAME);
  console.log('[NTSBDataSource] Downloading NTSB avall.zip to ' + destPath + ' ...');
  await faaService.downloadFile(NTSB_DOWNLOAD_URL, destPath);
  console.log('[NTSBDataSource] Download complete.');
  return { success: true, filePath: destPath };
}

async function parse(opts) {
  opts = opts || {};
  const mdb = await readMdb();
  const result = {
    sourcePath: mdb.zipPath,
    tables: {},
  };

  for (let i = 0; i < TARGET_TABLES.length; i++) {
    const sourceTableName = TARGET_TABLES[i];
    const table = mdb.reader.getTable(sourceTableName);
    const columns = table.getColumns();
    const rows = opts.includeData ? table.getData() : null;
    const rowCount = rows ? rows.length : table.rowCount;

    result.tables[sourceTableName] = {
      sourceTableName,
      targetTableName: TABLE_NAME_MAP[sourceTableName],
      columns,
      rows,
      rowCount,
    };
  }

  const total = Object.keys(result.tables).reduce(function (sum, tableName) {
    return sum + result.tables[tableName].rowCount;
  }, 0);

  console.log('[NTSBDataSource] Parsed ' + total + ' NTSB records from ' + mdb.zipPath);
  return { success: true, recordCount: total, data: result };
}

async function importToDatabase(parsedData) {
  const mdb = await readMdb();
  const db = databaseService.getDb();
  const now = databaseService.nowSql();
  let importedCount = 0;

  const importAll = db.transaction(function () {
    for (let i = 0; i < TARGET_TABLES.length; i++) {
      const sourceTableName = TARGET_TABLES[i];
      const table = mdb.reader.getTable(sourceTableName);
      const targetTableName = TABLE_NAME_MAP[sourceTableName];
      const columns = table.getColumns();

      db.prepare('DROP TABLE IF EXISTS ' + quoteIdentifier(targetTableName)).run();

      const columnDefs = columns.map(function (column) {
        return quoteIdentifier(column.name) + ' ' + sqliteTypeForMdbType(column.type);
      });
      columnDefs.push('created_at TEXT NOT NULL');

      db.prepare(
        'CREATE TABLE ' + quoteIdentifier(targetTableName) +
        ' (' + columnDefs.join(', ') + ')'
      ).run();

      const rows = table.getData();
      if (rows.length === 0) continue;

      const insertColumns = columns.map(function (column) { return column.name; }).concat(['created_at']);
      const placeholders = insertColumns.map(function () { return '?'; }).join(', ');
      const insertStmt = db.prepare(
        'INSERT INTO ' + quoteIdentifier(targetTableName) +
        ' (' + insertColumns.map(quoteIdentifier).join(', ') + ')' +
        ' VALUES (' + placeholders + ')'
      );

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const values = columns.map(function (column) {
          return toSqlValue(row[column.name]);
        });
        values.push(now);
        insertStmt.run(values);
      }

      importedCount += rows.length;
    }
  });

  importAll();

  createIndexIfColumnExists(db, 'ntsb_events', ['ev_id']);
  createIndexIfColumnExists(db, 'ntsb_events', ['ev_date']);
  createIndexIfColumnExists(db, 'ntsb_events', ['dec_latitude', 'dec_longitude']);
  createIndexIfColumnExists(db, 'ntsb_aircraft', ['ev_id']);
  createIndexIfColumnExists(db, 'ntsb_aircraft', ['regis_no']);
  createIndexIfColumnExists(db, 'ntsb_aircraft', ['Aircraft_Key']);
  createIndexIfColumnExists(db, 'ntsb_narratives', ['ev_id', 'Aircraft_Key']);
  createIndexIfColumnExists(db, 'ntsb_findings', ['ev_id', 'Aircraft_Key']);
  createIndexIfColumnExists(db, 'ntsb_flight_crew', ['ev_id', 'Aircraft_Key']);
  createIndexIfColumnExists(db, 'ntsb_engines', ['ev_id', 'Aircraft_Key']);
  createIndexIfColumnExists(db, 'ntsb_injury', ['ev_id', 'Aircraft_Key']);

  console.log('[NTSBDataSource] Imported ' + importedCount + ' records into NTSB tables');
  return { success: true, recordCount: importedCount };
}

async function updateAll() {
  const phases = [];
  try {
    phases.push('downloading');
    const dlResult = await download();
    phases.push('parsing');
    const parseResult = await parse();
    phases.push('importing');
    const importResult = await importToDatabase();
    phases.push('completed');
    return {
      success: true,
      phases,
      downloadResult: dlResult,
      parseCount: parseResult.recordCount,
      importCount: importResult.recordCount,
    };
  } catch (err) {
    phases.push('failed');
    return { success: false, phases, error: err.message };
  }
}

function tableExists(db, tableName) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName);
  return !!row;
}

function getStatus() {
  const db = databaseService.getDb();
  const statusTableName = 'ntsb_events';
  const recordCount = TARGET_TABLES.reduce(function (total, sourceTableName) {
    const tableName = TABLE_NAME_MAP[sourceTableName];
    if (!tableExists(db, tableName)) return total;
    return total + (db.prepare('SELECT COUNT(*) AS count FROM ' + quoteIdentifier(tableName)).get().count || 0);
  }, 0);

  const zipPath = getZipPath();
  const lastDownload = fs.existsSync(zipPath)
    ? fs.statSync(zipPath).mtime.toISOString()
    : null;

  let lastImport = null;
  if (tableExists(db, statusTableName)) {
    const lastRecord = db.prepare(
      'SELECT created_at FROM ' + quoteIdentifier(statusTableName) + ' ORDER BY created_at DESC LIMIT 1'
    ).get();
    lastImport = lastRecord ? lastRecord.created_at : null;
  }

  return {
    recordCount,
    lastDownload,
    lastParse: lastImport,
    lastImport,
    error: null,
  };
}

module.exports = {
  sourceId,
  name,
  description,
  url,
  download,
  parse,
  importToDatabase,
  updateAll,
  getStatus,
};

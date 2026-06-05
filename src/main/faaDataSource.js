const fs = require('fs');
const faaService = require('./faaService');
const cacheService = require('./cacheService');
const databaseService = require('./databaseService');

const SOURCE_ID = 'faa_aircraft';
const ZIP_FILENAME = 'ReleasableAircraft.zip';
const FAA_DOWNLOAD_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip';

// ── Data Source Interface ──────────────────────────────────────────────────

const sourceId = SOURCE_ID;
const name = 'FAA 注册飞机数据库';
const description = '从 FAA 官网下载美国注册飞机完整数据库，包含飞机注册号、制造信息、所有人信息等。';
const url = FAA_DOWNLOAD_URL;

async function download() {
  const destPath = cacheService.getDataFilePath(ZIP_FILENAME);
  console.log('[FAADataSource] Downloading FAA database to ' + destPath + ' ...');
  await faaService.downloadFile(FAA_DOWNLOAD_URL, destPath);
  console.log('[FAADataSource] Download complete.');
  return { success: true, filePath: destPath };
}

async function parse() {
  const zipPath = cacheService.getDataFilePath(ZIP_FILENAME);
  if (!fs.existsSync(zipPath)) {
    throw new Error('FAA 数据库文件未找到，请先点击"下载"获取数据。');
  }

  const faaMap = faaService.loadFromZip(zipPath);
  const records = [];
  faaMap.forEach(function (record, key) {
    records.push(record);
  });
  console.log('[FAADataSource] Parsed ' + records.length + ' FAA records');
  return { success: true, recordCount: records.length, data: records };
}

async function importToDatabase(parsedData) {
  let parseResult;
  if (parsedData) {
    parseResult = { success: true, recordCount: parsedData.length, data: parsedData };
  } else {
    parseResult = await parse();
  }
  const records = parseResult.data;

  const db = databaseService.getDb();
  const now = databaseService.nowSql();

  const insertStmt = db.prepare(`
    INSERT INTO faa_aircraft (
      n_number, serial_number, mfr_mdl_code, eng_mfr_mdl, year_mfr,
      type_registrant, name, street, street2, city, state, zip_code,
      region, county, country, last_action_date, cert_issue_date,
      certification, type_aircraft, type_engine, status_code,
      mode_s_code, fract_owner, air_worth_date, expiration_date,
      unique_id, kit_mfr, kit_model, mode_s_code_hex, created_at
    ) VALUES (
      @n_number, @serial_number, @mfr_mdl_code, @eng_mfr_mdl, @year_mfr,
      @type_registrant, @name, @street, @street2, @city, @state, @zip_code,
      @region, @county, @country, @last_action_date, @cert_issue_date,
      @certification, @type_aircraft, @type_engine, @status_code,
      @mode_s_code, @fract_owner, @air_worth_date, @expiration_date,
      @unique_id, @kit_mfr, @kit_model, @mode_s_code_hex, @created_at
    )
  `);

  const clearAll = db.prepare('DELETE FROM faa_aircraft');

  const importAll = db.transaction(function () {
    clearAll.run();

    let count = 0;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];

      // Normalize MODE S CODE HEX to lowercase
      const modeSCodeHex = (r['MODE S CODE HEX'] || '').toLowerCase().trim();

      insertStmt.run({
        n_number: r['N-NUMBER'] || null,
        serial_number: r['SERIAL NUMBER'] || null,
        mfr_mdl_code: r['MFR MDL CODE'] || null,
        eng_mfr_mdl: r['ENG MFR MDL'] || null,
        year_mfr: r['YEAR MFR'] || null,
        type_registrant: r['TYPE REGISTRANT'] || null,
        name: r['NAME'] || null,
        street: r['STREET'] || null,
        street2: r['STREET2'] || null,
        city: r['CITY'] || null,
        state: r['STATE'] || null,
        zip_code: r['ZIP CODE'] || null,
        region: r['REGION'] || null,
        county: r['COUNTY'] || null,
        country: r['COUNTRY'] || null,
        last_action_date: r['LAST ACTION DATE'] || null,
        cert_issue_date: r['CERT ISSUE DATE'] || null,
        certification: r['CERTIFICATION'] || null,
        type_aircraft: r['TYPE AIRCRAFT'] || null,
        type_engine: r['TYPE ENGINE'] || null,
        status_code: r['STATUS CODE'] || null,
        mode_s_code: r['MODE S CODE'] || null,
        fract_owner: r['FRACT OWNER'] || null,
        air_worth_date: r['AIR WORTH DATE'] || null,
        expiration_date: r['EXPIRATION DATE'] || null,
        unique_id: r['UNIQUE ID'] || null,
        kit_mfr: r['KIT MFR'] || null,
        kit_model: r['KIT MODEL'] || null,
        mode_s_code_hex: modeSCodeHex || null,
        created_at: now,
      });
      count++;
    }
    return count;
  });

  const count = importAll();
  console.log('[FAADataSource] Imported ' + count + ' records into faa_aircraft');
  return { success: true, recordCount: count };
}

async function updateAll() {
  const phases = [];
  try {
    phases.push('downloading');
    const dlResult = await download();
    phases.push('parsing');
    const parseResult = await parse();
    phases.push('importing');
    const importResult = await importToDatabase(parseResult.data);
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

function getStatus() {
  const db = databaseService.getDb();
  const recordCount = db.prepare('SELECT COUNT(*) AS count FROM faa_aircraft').get().count || 0;

  const zipPath = cacheService.getDataFilePath(ZIP_FILENAME);
  const lastDownload = fs.existsSync(zipPath)
    ? fs.statSync(zipPath).mtime.toISOString()
    : null;

  const lastRecord = db.prepare(
    'SELECT created_at FROM faa_aircraft ORDER BY id DESC LIMIT 1'
  ).get();
  const lastImport = lastRecord ? lastRecord.created_at : null;

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

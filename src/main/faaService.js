const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const cacheService = require('./cacheService');

const FAA_ZIP_FILENAME = 'ReleasableAircraft.zip';
const FAA_DOWNLOAD_URL = 'https://registry.faa.gov/database/ReleasableAircraft.zip';
const PROJECT_ROOT = path.join(__dirname, '..', '..');

let faaMap = new Map();
let recordCount = 0;
let loaded = false;
let loadError = null;

function findZipFile() {
  // Check writable data directory first (downloaded files go here)
  const dataPath = cacheService.getDataFilePath(FAA_ZIP_FILENAME);
  if (fs.existsSync(dataPath)) return dataPath;

  // In development, also check project root for the initial zip
  if (!app.isPackaged) {
    const rootPath = path.join(PROJECT_ROOT, FAA_ZIP_FILENAME);
    if (fs.existsSync(rootPath)) return rootPath;
  }

  return null;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseMasterText(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) {
    throw new Error('MASTER.txt is empty');
  }

  const headers = parseCSVLine(lines[0]);

  const modeSCodeIndex = headers.findIndex(h => h === 'MODE S CODE HEX');
  if (modeSCodeIndex === -1) {
    throw new Error('MODE S CODE HEX column not found in MASTER.txt');
  }

  const newMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    try {
      const fields = parseCSVLine(line);
      const modeSCode = fields[modeSCodeIndex];

      if (!modeSCode || modeSCode.trim() === '') continue;

      const record = {};
      for (let j = 0; j < headers.length; j++) {
        record[headers[j]] = j < fields.length ? fields[j] : '';
      }

      newMap.set(modeSCode.toLowerCase().trim(), record);
    } catch (_err) {
      // Skip malformed lines
    }
  }

  return newMap;
}

function loadFromZip(zipPath) {
  if (!fs.existsSync(zipPath)) {
    throw new Error('FAA 数据库文件未找到: ' + zipPath);
  }

  const zip = new AdmZip(zipPath);

  const zipEntries = zip.getEntries();
  const masterEntry = zipEntries.find(
    e => e.entryName.toUpperCase() === 'MASTER.TXT' || e.entryName === 'MASTER.txt'
  );

  if (!masterEntry) {
    const availableFiles = zipEntries.map(e => e.entryName).join(', ');
    throw new Error('MASTER.txt not found in zip. Available files: ' + availableFiles);
  }

  const content = zip.readAsText(masterEntry, 'utf8');
  return parseMasterText(content);
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl) => {
      const urlObj = new URL(requestUrl);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DataSecurityApp/1.0)',
        },
        timeout: 600000,
      };

      const mod = requestUrl.startsWith('https') ? https : http;

      const req = mod.request(options, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const redirectUrl = response.headers.location;
          const resolvedUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, requestUrl).href;
          doRequest(resolvedUrl);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error('Download failed with status code ' + response.statusCode));
          return;
        }

        // Ensure parent directory exists before writing
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(destPath);
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timed out (10 minutes)'));
      });

      req.end();
    };

    doRequest(url);
  });
}

async function initialize() {
  try {
    const zipPath = findZipFile();

    if (!zipPath) {
      loaded = false;
      loadError = 'FAA 数据库文件未找到，请点击"下载 FAA 数据库"下载';
      console.log(loadError);
      return;
    }

    faaMap = loadFromZip(zipPath);
    recordCount = faaMap.size;
    loaded = true;
    loadError = null;
    console.log('FAA database loaded from ' + zipPath + ': ' + recordCount + ' records');
  } catch (err) {
    loaded = false;
    loadError = err.message;
    console.error('FAA initialization error:', err);
  }
}

function getStats() {
  return {
    recordCount,
    loaded,
    error: loadError,
  };
}

function getAircraftInfo(icao24) {
  if (!icao24) return null;
  const key = icao24.toLowerCase().trim();
  return faaMap.get(key) || null;
}

async function refresh() {
  const zipPath = cacheService.getDataFilePath(FAA_ZIP_FILENAME);
  console.log('Downloading FAA database to ' + zipPath + ' ...');
  await downloadFile(FAA_DOWNLOAD_URL, zipPath);
  console.log('Download complete. Parsing MASTER.txt...');
  faaMap = loadFromZip(zipPath);
  recordCount = faaMap.size;
  loaded = true;
  loadError = null;
  console.log('FAA database refreshed: ' + recordCount + ' records');
  return { recordCount };
}

module.exports = { initialize, getStats, getAircraftInfo, refresh, parseCSVLine, parseMasterText, loadFromZip, downloadFile };

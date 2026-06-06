'use strict';

const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index++;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  result.push(current.trim());
  return result;
}

function parseMasterText(content) {
  const lines = content.split(/\r?\n/);
  if (!lines.length) throw new Error('MASTER.txt is empty');
  const headers = parseCSVLine(lines[0]);
  const modeSIndex = headers.indexOf('MODE S CODE HEX');
  if (modeSIndex < 0) throw new Error('MODE S CODE HEX column was not found');
  const records = new Map();
  for (let index = 1; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const fields = parseCSVLine(lines[index]);
    const modeS = String(fields[modeSIndex] || '').trim().toLowerCase();
    if (!modeS) continue;
    const record = {};
    for (let fieldIndex = 0; fieldIndex < headers.length; fieldIndex++) {
      record[headers[fieldIndex]] = fields[fieldIndex] || '';
    }
    records.set(modeS, record);
  }
  return records;
}

function loadFromZipBuffer(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const master = zip.getEntries().find((entry) => entry.entryName.toUpperCase() === 'MASTER.TXT');
  if (!master) throw new Error('MASTER.txt was not found in the FAA archive');
  return parseMasterText(zip.readAsText(master, 'utf8'));
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const request = (requestUrl) => {
      const parsed = new URL(requestUrl);
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataSecurityApp/1.0)' },
        timeout: 600000,
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          request(new URL(response.headers.location, requestUrl).href);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error('Download failed with status code ' + response.statusCode));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Download timed out')));
      req.end();
    };
    request(url);
  });
}

module.exports = { parseCSVLine, parseMasterText, loadFromZipBuffer, downloadBuffer };

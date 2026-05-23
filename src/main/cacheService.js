const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getDataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return path.join(__dirname, '..', '..', 'data');
}

function ensureDataDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(filename) {
  const dir = getDataDir();
  ensureDataDir(dir);
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('Error reading ' + filename + ':', err.message);
    return null;
  }
}

function writeJsonFile(filename, data) {
  const dir = getDataDir();
  ensureDataDir(dir);
  const filePath = path.join(dir, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing ' + filename + ':', err.message);
  }
}

function fileExistsInData(filename) {
  const filePath = path.join(getDataDir(), filename);
  return fs.existsSync(filePath);
}

function getDataFilePath(filename) {
  const dir = getDataDir();
  ensureDataDir(dir);
  return path.join(dir, filename);
}

module.exports = { readJsonFile, writeJsonFile, fileExistsInData, getDataFilePath, ensureDataDir: () => ensureDataDir(getDataDir()) };

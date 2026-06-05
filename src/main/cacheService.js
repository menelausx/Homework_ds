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

function cleanRawDataCache() {
  const dir = getDataDir();
  ensureDataDir(dir);

  const deleted = [];
  const skipped = [];
  const protectedText = 'app.db';

  function isProtected(filePath) {
    return path.relative(dir, filePath).toLowerCase().includes(protectedText);
  }

  function removeEmptyDirectory(dirPath) {
    if (dirPath === dir || isProtected(dirPath)) return;
    try {
      if (fs.readdirSync(dirPath).length === 0) {
        fs.rmdirSync(dirPath);
        deleted.push(path.relative(dir, dirPath));
      }
    } catch (err) {
      skipped.push({ path: path.relative(dir, dirPath), error: err.message });
    }
  }

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath);

      if (isProtected(fullPath)) {
        skipped.push({ path: relativePath, reason: 'protected' });
        continue;
      }

      try {
        if (entry.isDirectory()) {
          walk(fullPath);
          removeEmptyDirectory(fullPath);
        } else {
          fs.unlinkSync(fullPath);
          deleted.push(relativePath);
        }
      } catch (err) {
        skipped.push({ path: relativePath, error: err.message });
      }
    }
  }

  walk(dir);

  return {
    success: true,
    deleted,
    skipped,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
  };
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  fileExistsInData,
  getDataFilePath,
  cleanRawDataCache,
  ensureDataDir: () => ensureDataDir(getDataDir()),
};

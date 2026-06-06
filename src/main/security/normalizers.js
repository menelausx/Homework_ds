'use strict';

function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUsername(value) {
  return normalizeText(value);
}

function normalizeIcao(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizeUpperCode(value) {
  return String(value == null ? '' : value).normalize('NFKC').trim().toUpperCase();
}

function normalizeDimension(value) {
  const normalized = String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'UNKNOWN';
}

function normalizeInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? String(number) : '';
}

module.exports = {
  normalizeText,
  normalizeUsername,
  normalizeIcao,
  normalizeUpperCode,
  normalizeDimension,
  normalizeInteger,
};

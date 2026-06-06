'use strict';

const cryptoService = require('./cryptoService');
const { normalizeText } = require('./normalizers');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'with',
]);

function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const terms = normalized.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
  return [...new Set(terms.filter((term) => term.length > 1 && !STOP_WORDS.has(term)))];
}

function termTokens(text, domain, keyVersion) {
  return tokenize(text).map((term) => cryptoService.blindIndex(domain, term, keyVersion));
}

function searchRecordTokens(db, recordType, query, domain) {
  const tokens = termTokens(query, domain);
  if (tokens.length === 0) return [];
  const placeholders = tokens.map(() => '?').join(', ');
  return db.prepare(`
    SELECT record_token
    FROM secure_terms
    WHERE record_type = ? AND term_token IN (${placeholders})
    GROUP BY record_token
    HAVING COUNT(DISTINCT term_token) = ?
  `).all(recordType, ...tokens, tokens.length).map((row) => row.record_token);
}

module.exports = { STOP_WORDS, tokenize, termTokens, searchRecordTokens };

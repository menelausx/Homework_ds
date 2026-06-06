'use strict';

const databaseService = require('./databaseService');
const cryptoService = require('./security/cryptoService');
const dimensionService = require('./security/dimensionService');
const searchIndexService = require('./security/searchIndexService');
const {
  normalizeUpperCode,
  normalizeInteger,
  normalizeDimension,
} = require('./security/normalizers');

const EMPTY_OVERVIEW = {
  totalEvents: 0,
  fatalEvents: 0,
  fatalRate: 0,
  aircraftCount: 0,
  geoEventCount: 0,
  narrativeEventCount: 0,
  topRegion: null,
};

function hasData(db) {
  return databaseService.tableExists(db, 'ntsb_event_facts')
    && db.prepare('SELECT 1 FROM ntsb_event_facts LIMIT 1').get();
}

function dimToken(domain, value, normalizer) {
  return dimensionService.tokenFor(domain, value, normalizer);
}

function normalizeFilters(filters) {
  const input = filters && typeof filters === 'object' ? filters : {};
  const result = {};
  const from = Number.parseInt(input.yearFrom, 10);
  const to = Number.parseInt(input.yearTo, 10);
  if (Number.isFinite(from)) result.yearFrom = Math.max(1900, Math.min(2100, from));
  if (Number.isFinite(to)) result.yearTo = Math.max(1900, Math.min(2100, to));
  if (result.yearFrom != null && result.yearTo != null && result.yearFrom > result.yearTo) {
    [result.yearFrom, result.yearTo] = [result.yearTo, result.yearFrom];
  }
  for (const key of ['country', 'state', 'severity', 'acftCategory', 'acftMake', 'damage']) {
    if (input[key] != null && String(input[key]).trim()) result[key] = String(input[key]).slice(0, 256);
  }
  return result;
}

function buildFilteredEventsCte(filters) {
  const f = normalizeFilters(filters);
  const where = [];
  const aircraftWhere = [];
  const params = {};

  if (f.yearFrom != null || f.yearTo != null) {
    const min = f.yearFrom == null ? f.yearTo : f.yearFrom;
    const max = f.yearTo == null ? f.yearFrom : f.yearTo;
    const placeholders = [];
    for (let year = min; year <= max; year++) {
      const name = 'year' + year;
      placeholders.push('@' + name);
      params[name] = dimToken('ntsb.year', year, normalizeInteger);
    }
    where.push('e.year_token IN (' + placeholders.join(', ') + ')');
  }
  if (f.country) {
    where.push('e.country_token = @country');
    params.country = dimToken('ntsb.country', normalizeDimension(f.country));
  }
  if (f.state) {
    where.push('e.state_token = @state');
    params.state = dimToken('ntsb.state', normalizeDimension(f.state));
  }
  if (f.severity) {
    where.push('e.severity_token = @severity');
    params.severity = dimToken('ntsb.severity', normalizeUpperCode(f.severity), normalizeUpperCode);
  }
  if (f.acftCategory) {
    aircraftWhere.push('a.category_token = @acftCategory');
    params.acftCategory = dimToken('ntsb.aircraft_category', normalizeDimension(f.acftCategory));
  }
  if (f.acftMake) {
    aircraftWhere.push('a.make_token = @acftMake');
    params.acftMake = dimToken('ntsb.aircraft_make', normalizeUpperCode(f.acftMake), normalizeUpperCode);
  }
  if (f.damage) {
    aircraftWhere.push('a.damage_token = @damage');
    params.damage = dimToken('ntsb.damage', normalizeDimension(f.damage));
  }
  if (aircraftWhere.length) {
    where.push(
      'EXISTS (SELECT 1 FROM ntsb_aircraft_facts a WHERE a.event_token = e.event_token AND '
      + aircraftWhere.join(' AND ') + ')'
    );
  }

  return {
    sql: `
      WITH filtered_events AS (
        SELECT
          e.event_token, e.year_token, e.country_token, e.state_token,
          e.severity_token, e.light_condition_token, e.weather_condition_token,
          e.visibility_bucket_token, e.wind_bucket_token, e.geo_cell_token,
          e.has_geo_token, e.has_narrative_token, e.fatal_token
        FROM ntsb_event_facts e
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      )
    `,
    params,
  };
}

function resolveGroups(db, domain, rows, tokenField, labelField) {
  const values = dimensionService.getMany(domain, rows.map((row) => row[tokenField]), db);
  return rows.map((row) => {
    const result = { ...row };
    const token = row[tokenField];
    result[labelField] = token ? values.get(Buffer.from(token).toString('hex')) : null;
    delete result[tokenField];
    return result;
  });
}

function getFilterOptions() {
  const db = databaseService.getDb();
  if (!hasData(db)) {
    return {
      years: { min: null, max: null },
      countries: [],
      states: [],
      severities: [],
      aircraftCategories: [],
      damages: [],
    };
  }
  const grouped = (table, field, limit) => db.prepare(`
    SELECT ${field} AS token, COUNT(*) AS count
    FROM ${table}
    WHERE ${field} IS NOT NULL
    GROUP BY ${field}
    ORDER BY count DESC
    ${limit ? 'LIMIT ' + limit : ''}
  `).all();
  const yearRows = resolveGroups(db, 'ntsb.year', grouped('ntsb_event_facts', 'year_token'), 'token', 'value')
    .map((row) => ({ ...row, value: Number(row.value) }))
    .sort((a, b) => a.value - b.value);
  return {
    years: {
      min: yearRows.length ? yearRows[0].value : null,
      max: yearRows.length ? yearRows[yearRows.length - 1].value : null,
    },
    countries: resolveGroups(db, 'ntsb.country', grouped('ntsb_event_facts', 'country_token', 120), 'token', 'value'),
    states: resolveGroups(db, 'ntsb.state', grouped('ntsb_event_facts', 'state_token', 120), 'token', 'value'),
    severities: resolveGroups(db, 'ntsb.severity', grouped('ntsb_event_facts', 'severity_token'), 'token', 'value'),
    aircraftCategories: resolveGroups(db, 'ntsb.aircraft_category', grouped('ntsb_aircraft_facts', 'category_token', 80), 'token', 'value'),
    damages: resolveGroups(db, 'ntsb.damage', grouped('ntsb_aircraft_facts', 'damage_token'), 'token', 'value'),
  };
}

function getOverview(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return EMPTY_OVERVIEW;
  const cte = buildFilteredEventsCte(filters);
  const params = {
    ...cte.params,
    fatal: dimToken('ntsb.fatal', '1'),
    yesGeo: dimToken('ntsb.has_geo', '1'),
    yesNarrative: dimToken('ntsb.has_narrative', '1'),
  };
  const row = db.prepare(cte.sql + `
    SELECT
      COUNT(*) AS totalEvents,
      SUM(CASE WHEN fatal_token = @fatal THEN 1 ELSE 0 END) AS fatalEvents,
      SUM(CASE WHEN has_geo_token = @yesGeo THEN 1 ELSE 0 END) AS geoEventCount,
      SUM(CASE WHEN has_narrative_token = @yesNarrative THEN 1 ELSE 0 END) AS narrativeEventCount
    FROM filtered_events
  `).get(params);
  const aircraft = db.prepare(cte.sql + `
    SELECT COUNT(*) AS aircraftCount
    FROM ntsb_aircraft_facts a
    INNER JOIN filtered_events f ON f.event_token = a.event_token
  `).get(cte.params);
  const top = db.prepare(cte.sql + `
    SELECT country_token, state_token, COUNT(*) AS count
    FROM filtered_events
    GROUP BY country_token, state_token
    ORDER BY count DESC
    LIMIT 1
  `).get(cte.params);
  const total = row.totalEvents || 0;
  return {
    totalEvents: total,
    fatalEvents: row.fatalEvents || 0,
    fatalRate: total ? (row.fatalEvents || 0) / total : 0,
    aircraftCount: aircraft.aircraftCount || 0,
    geoEventCount: row.geoEventCount || 0,
    narrativeEventCount: row.narrativeEventCount || 0,
    topRegion: top ? {
      country: dimensionService.get('ntsb.country', top.country_token, db),
      state: dimensionService.get('ntsb.state', top.state_token, db),
      count: top.count,
    } : null,
  };
}

function getYearlyTrend(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return [];
  const cte = buildFilteredEventsCte(filters);
  const rows = db.prepare(cte.sql + `
    SELECT year_token, severity_token, COUNT(*) AS count
    FROM filtered_events
    WHERE year_token IS NOT NULL
    GROUP BY year_token, severity_token
  `).all(cte.params);
  const byYear = new Map();
  for (const row of rows) {
    const year = Number(dimensionService.get('ntsb.year', row.year_token, db));
    const severity = String(dimensionService.get('ntsb.severity', row.severity_token, db) || 'UNKNOWN').toUpperCase();
    if (!byYear.has(year)) byYear.set(year, { year, total: 0, fatal: 0, serious: 0, minor: 0, none: 0, other: 0 });
    const item = byYear.get(year);
    item.total += row.count;
    if (severity === 'FATL') item.fatal += row.count;
    else if (severity === 'SERS') item.serious += row.count;
    else if (severity === 'MINR') item.minor += row.count;
    else if (severity === 'NONE') item.none += row.count;
    else item.other += row.count;
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

function getSeverityDistribution(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return [];
  const cte = buildFilteredEventsCte(filters);
  const rows = db.prepare(cte.sql + `
    SELECT severity_token, COUNT(*) AS count
    FROM filtered_events
    GROUP BY severity_token
    ORDER BY count DESC
  `).all(cte.params);
  return resolveGroups(db, 'ntsb.severity', rows, 'severity_token', 'severity');
}

function getGeoAggregation(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return [];
  const cte = buildFilteredEventsCte(filters);
  const rows = db.prepare(cte.sql + `
    SELECT
      geo_cell_token,
      COUNT(*) AS count,
      SUM(CASE WHEN fatal_token = @fatal THEN 1 ELSE 0 END) AS fatalCount
    FROM filtered_events
    WHERE geo_cell_token IS NOT NULL
    GROUP BY geo_cell_token
    ORDER BY count DESC
    LIMIT 650
  `).all({ ...cte.params, fatal: dimToken('ntsb.fatal', '1') });
  const geoValues = dimensionService.getMany(
    'ntsb.geo_cell',
    rows.map((row) => row.geo_cell_token),
    db
  );
  return rows.map((row) => {
    const geo = geoValues.get(Buffer.from(row.geo_cell_token).toString('hex'));
    return geo ? {
      ...geo,
      count: row.count,
      fatalCount: row.fatalCount || 0,
    } : null;
  }).filter((row) => (
    row
    && Number.isFinite(Number(row.lat))
    && Number.isFinite(Number(row.lng))
    && !(Number(row.lat) === 0 && Number(row.lng) === 0)
  ));
}

function groupedAircraft(db, cte, field, domain, limit) {
  const rows = db.prepare(cte.sql + `
    SELECT a.${field} AS token, COUNT(*) AS count
    FROM ntsb_aircraft_facts a
    INNER JOIN filtered_events f ON f.event_token = a.event_token
    GROUP BY a.${field}
    ORDER BY count DESC
    ${limit ? 'LIMIT ' + limit : ''}
  `).all(cte.params);
  return resolveGroups(db, domain, rows, 'token', 'label');
}

function getAircraftBreakdown(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return { categories: [], makes: [], models: [], damages: [], ageBuckets: [] };
  const cte = buildFilteredEventsCte(filters);
  return {
    categories: groupedAircraft(db, cte, 'category_token', 'ntsb.aircraft_category', 12),
    makes: groupedAircraft(db, cte, 'make_token', 'ntsb.aircraft_make', 12),
    models: groupedAircraft(db, cte, 'model_token', 'ntsb.aircraft_model', 12),
    damages: groupedAircraft(db, cte, 'damage_token', 'ntsb.damage', 12),
    ageBuckets: groupedAircraft(db, cte, 'age_bucket_token', 'ntsb.age_bucket'),
  };
}

function groupedEvents(db, cte, field, domain) {
  const rows = db.prepare(cte.sql + `
    SELECT
      ${field} AS token,
      COUNT(*) AS count,
      SUM(CASE WHEN fatal_token = @fatal THEN 1 ELSE 0 END) AS fatalCount
    FROM filtered_events
    GROUP BY ${field}
    ORDER BY count DESC
    LIMIT 12
  `).all({ ...cte.params, fatal: dimToken('ntsb.fatal', '1') });
  return resolveGroups(db, domain, rows, 'token', 'label');
}

function getWeatherBreakdown(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return { light: [], conditions: [], visibility: [], wind: [] };
  const cte = buildFilteredEventsCte(filters);
  return {
    light: groupedEvents(db, cte, 'light_condition_token', 'ntsb.light'),
    conditions: groupedEvents(db, cte, 'weather_condition_token', 'ntsb.weather'),
    visibility: groupedEvents(db, cte, 'visibility_bucket_token', 'ntsb.visibility_bucket'),
    wind: groupedEvents(db, cte, 'wind_bucket_token', 'ntsb.wind_bucket'),
  };
}

function getFindingBreakdown(filters) {
  const db = databaseService.getDb();
  if (!hasData(db)) return { categories: [], topFindings: [], severityMatrix: [] };
  const cte = buildFilteredEventsCte(filters);
  const categories = db.prepare(cte.sql + `
    SELECT x.category_token AS token, COUNT(*) AS count
    FROM ntsb_finding_facts x
    INNER JOIN filtered_events f ON f.event_token = x.event_token
    GROUP BY x.category_token
    ORDER BY count DESC
    LIMIT 12
  `).all(cte.params);
  const findings = db.prepare(cte.sql + `
    SELECT x.description_group_token AS token, COUNT(*) AS count
    FROM ntsb_finding_facts x
    INNER JOIN filtered_events f ON f.event_token = x.event_token
    GROUP BY x.description_group_token
    ORDER BY count DESC
    LIMIT 12
  `).all(cte.params);
  const matrix = db.prepare(cte.sql + `
    SELECT x.category_token, f.severity_token, COUNT(*) AS count
    FROM ntsb_finding_facts x
    INNER JOIN filtered_events f ON f.event_token = x.event_token
    GROUP BY x.category_token, f.severity_token
  `).all(cte.params).map((row) => ({
    category: dimensionService.get('ntsb.finding_category', row.category_token, db),
    severity: dimensionService.get('ntsb.severity', row.severity_token, db),
    count: row.count,
  }));
  return {
    categories: resolveGroups(db, 'ntsb.finding_category', categories, 'token', 'label'),
    topFindings: resolveGroups(db, 'ntsb.finding_description', findings, 'token', 'label'),
    severityMatrix: matrix,
  };
}

function searchText(recordType, query) {
  if (!['narratives', 'findings'].includes(recordType)) throw new TypeError('Unsupported record type');
  if (typeof query !== 'string' || query.length > 500) throw new TypeError('Invalid search query');
  const db = databaseService.getDb();
  const domain = recordType === 'narratives'
    ? cryptoService.DOMAINS.TERM_NARRATIVE
    : cryptoService.DOMAINS.TERM_FINDING;
  const tokens = searchIndexService.searchRecordTokens(db, recordType, query, domain);
  if (tokens.length === 0) return [];
  const placeholders = tokens.map(() => '?').join(', ');
  return db.prepare(`
    SELECT record_id, record_type, payload_cipher
    FROM ntsb_records_secure
    WHERE record_type = ? AND record_token IN (${placeholders})
    LIMIT 200
  `).all(recordType, ...tokens).map((row) => cryptoService.decryptJson(row.payload_cipher, {
    recordType: 'ntsb_records_secure',
    field: row.record_type,
    recordId: row.record_id,
  }));
}

module.exports = {
  getFilterOptions,
  getOverview,
  getYearlyTrend,
  getSeverityDistribution,
  getGeoAggregation,
  getAircraftBreakdown,
  getWeatherBreakdown,
  getFindingBreakdown,
  searchNarratives: (query) => searchText('narratives', query),
  searchFindings: (query) => searchText('findings', query),
};

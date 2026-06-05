const databaseService = require('./databaseService');

const EMPTY_OVERVIEW = {
  totalEvents: 0,
  fatalEvents: 0,
  fatalRate: 0,
  aircraftCount: 0,
  geoEventCount: 0,
  narrativeEventCount: 0,
  topRegion: null,
};

function quoteIdentifier(identifier) {
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

function tableExists(db, tableName) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName);
  return !!row;
}

function getNtsbDb() {
  const db = databaseService.getDb();
  if (!tableExists(db, 'ntsb_events')) {
    return null;
  }
  return db;
}

function normalizeFilters(filters) {
  filters = filters || {};
  const normalized = {};

  const yearFrom = parseInt(filters.yearFrom, 10);
  const yearTo = parseInt(filters.yearTo, 10);
  if (!Number.isNaN(yearFrom)) normalized.yearFrom = yearFrom;
  if (!Number.isNaN(yearTo)) normalized.yearTo = yearTo;

  ['country', 'state', 'severity', 'acftCategory', 'acftMake', 'damage'].forEach(function (key) {
    if (filters[key] != null && String(filters[key]).trim() !== '') {
      normalized[key] = String(filters[key]).trim();
    }
  });

  return normalized;
}

function buildFilteredEventsCte(filters) {
  const f = normalizeFilters(filters);
  const where = [];
  const aircraftWhere = [];
  const params = {};

  if (f.yearFrom != null) {
    where.push('e.ev_year >= @yearFrom');
    params.yearFrom = f.yearFrom;
  }
  if (f.yearTo != null) {
    where.push('e.ev_year <= @yearTo');
    params.yearTo = f.yearTo;
  }
  if (f.country) {
    where.push('TRIM(COALESCE(e.ev_country, \'\')) = @country');
    params.country = f.country;
  }
  if (f.state) {
    where.push('TRIM(COALESCE(e.ev_state, \'\')) = @state');
    params.state = f.state;
  }
  if (f.severity) {
    where.push('TRIM(COALESCE(e.ev_highest_injury, \'\')) = @severity');
    params.severity = f.severity;
  }
  if (f.acftCategory) {
    aircraftWhere.push('TRIM(COALESCE(a.acft_category, \'\')) = @acftCategory');
    params.acftCategory = f.acftCategory;
  }
  if (f.acftMake) {
    aircraftWhere.push('UPPER(TRIM(COALESCE(a.acft_make, \'\'))) = @acftMake');
    params.acftMake = f.acftMake.toUpperCase();
  }
  if (f.damage) {
    aircraftWhere.push('TRIM(COALESCE(a.damage, \'\')) = @damage');
    params.damage = f.damage;
  }
  if (aircraftWhere.length) {
    where.push(
      'EXISTS (SELECT 1 FROM ntsb_aircraft a WHERE a.ev_id = e.ev_id AND ' +
      aircraftWhere.join(' AND ') +
      ')'
    );
  }

  return {
    sql:
      'WITH filtered_events AS (' +
      ' SELECT e.* FROM ntsb_events e' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ')',
    params,
  };
}

function runAll(db, sql, params) {
  return db.prepare(sql).all(params || {});
}

function runGet(db, sql, params) {
  return db.prepare(sql).get(params || {});
}

function severityExpr(alias) {
  return "COALESCE(NULLIF(TRIM(" + alias + ".ev_highest_injury), ''), 'UNKNOWN')";
}

function fatalExpr(alias) {
  return "CASE WHEN UPPER(TRIM(COALESCE(" + alias + ".ev_highest_injury, ''))) = 'FATL' THEN 1 ELSE 0 END";
}

function countDistinctNarrativesSql() {
  return `
    SELECT COUNT(DISTINCT n.ev_id) AS count
    FROM ntsb_narratives n
    INNER JOIN filtered_events f ON f.ev_id = n.ev_id
    WHERE
      NULLIF(TRIM(COALESCE(n.narr_accp, '')), '') IS NOT NULL OR
      NULLIF(TRIM(COALESCE(n.narr_accf, '')), '') IS NOT NULL OR
      NULLIF(TRIM(COALESCE(n.narr_cause, '')), '') IS NOT NULL OR
      NULLIF(TRIM(COALESCE(n.narr_inc, '')), '') IS NOT NULL
  `;
}

function getFilterOptions() {
  const db = getNtsbDb();
  if (!db) {
    return {
      years: { min: null, max: null },
      countries: [],
      states: [],
      severities: [],
      aircraftCategories: [],
      damages: [],
    };
  }

  const years = runGet(db, 'SELECT MIN(ev_year) AS min, MAX(ev_year) AS max FROM ntsb_events WHERE ev_year IS NOT NULL') || {};
  const countries = runAll(db, `
    SELECT TRIM(ev_country) AS value, COUNT(*) AS count
    FROM ntsb_events
    WHERE NULLIF(TRIM(COALESCE(ev_country, '')), '') IS NOT NULL
    GROUP BY TRIM(ev_country)
    ORDER BY count DESC, value
    LIMIT 120
  `);
  const states = runAll(db, `
    SELECT TRIM(ev_state) AS value, COUNT(*) AS count
    FROM ntsb_events
    WHERE NULLIF(TRIM(COALESCE(ev_state, '')), '') IS NOT NULL
    GROUP BY TRIM(ev_state)
    ORDER BY count DESC, value
    LIMIT 120
  `);
  const severities = runAll(db, `
    SELECT TRIM(ev_highest_injury) AS value, COUNT(*) AS count
    FROM ntsb_events
    WHERE NULLIF(TRIM(COALESCE(ev_highest_injury, '')), '') IS NOT NULL
    GROUP BY TRIM(ev_highest_injury)
    ORDER BY count DESC, value
  `);
  const aircraftCategories = tableExists(db, 'ntsb_aircraft') ? runAll(db, `
    SELECT TRIM(acft_category) AS value, COUNT(*) AS count
    FROM ntsb_aircraft
    WHERE NULLIF(TRIM(COALESCE(acft_category, '')), '') IS NOT NULL
    GROUP BY TRIM(acft_category)
    ORDER BY count DESC, value
    LIMIT 80
  `) : [];
  const damages = tableExists(db, 'ntsb_aircraft') ? runAll(db, `
    SELECT TRIM(damage) AS value, COUNT(*) AS count
    FROM ntsb_aircraft
    WHERE NULLIF(TRIM(COALESCE(damage, '')), '') IS NOT NULL
    GROUP BY TRIM(damage)
    ORDER BY count DESC, value
  `) : [];

  return {
    years,
    countries,
    states,
    severities,
    aircraftCategories,
    damages,
  };
}

function getOverview(filters) {
  const db = getNtsbDb();
  if (!db) return EMPTY_OVERVIEW;

  const cte = buildFilteredEventsCte(filters);
  const row = runGet(db, cte.sql + `
    SELECT
      COUNT(*) AS totalEvents,
      SUM(${fatalExpr('f')}) AS fatalEvents,
      SUM(CASE WHEN f.dec_latitude IS NOT NULL AND f.dec_longitude IS NOT NULL THEN 1 ELSE 0 END) AS geoEventCount
    FROM filtered_events f
  `, cte.params) || {};

  const aircraft = tableExists(db, 'ntsb_aircraft') ? runGet(db, cte.sql + `
    SELECT COUNT(*) AS aircraftCount
    FROM ntsb_aircraft a
    INNER JOIN filtered_events f ON f.ev_id = a.ev_id
  `, cte.params) : { aircraftCount: 0 };

  const narratives = tableExists(db, 'ntsb_narratives') ? runGet(db, cte.sql + countDistinctNarrativesSql(), cte.params) : { count: 0 };

  const topRegion = runGet(db, cte.sql + `
    SELECT
      COALESCE(NULLIF(TRIM(f.ev_country), ''), 'UNKNOWN') AS country,
      COALESCE(NULLIF(TRIM(f.ev_state), ''), '') AS state,
      COUNT(*) AS count
    FROM filtered_events f
    GROUP BY country, state
    ORDER BY count DESC
    LIMIT 1
  `, cte.params);

  const total = row.totalEvents || 0;
  const fatal = row.fatalEvents || 0;
  return {
    totalEvents: total,
    fatalEvents: fatal,
    fatalRate: total ? fatal / total : 0,
    aircraftCount: aircraft.aircraftCount || 0,
    geoEventCount: row.geoEventCount || 0,
    narrativeEventCount: narratives.count || 0,
    topRegion: topRegion || null,
  };
}

function getYearlyTrend(filters) {
  const db = getNtsbDb();
  if (!db) return [];

  const cte = buildFilteredEventsCte(filters);
  return runAll(db, cte.sql + `
    SELECT
      f.ev_year AS year,
      COUNT(*) AS total,
      SUM(${fatalExpr('f')}) AS fatal,
      SUM(CASE WHEN UPPER(${severityExpr('f')}) = 'SERS' THEN 1 ELSE 0 END) AS serious,
      SUM(CASE WHEN UPPER(${severityExpr('f')}) = 'MINR' THEN 1 ELSE 0 END) AS minor,
      SUM(CASE WHEN UPPER(${severityExpr('f')}) = 'NONE' THEN 1 ELSE 0 END) AS none,
      SUM(CASE WHEN UPPER(${severityExpr('f')}) NOT IN ('FATL', 'SERS', 'MINR', 'NONE') THEN 1 ELSE 0 END) AS other
    FROM filtered_events f
    WHERE f.ev_year IS NOT NULL
    GROUP BY f.ev_year
    ORDER BY f.ev_year
  `, cte.params);
}

function getSeverityDistribution(filters) {
  const db = getNtsbDb();
  if (!db) return [];

  const cte = buildFilteredEventsCte(filters);
  return runAll(db, cte.sql + `
    SELECT ${severityExpr('f')} AS severity, COUNT(*) AS count
    FROM filtered_events f
    GROUP BY severity
    ORDER BY count DESC
  `, cte.params);
}

function getGeoAggregation(filters) {
  const db = getNtsbDb();
  if (!db) return [];

  const cte = buildFilteredEventsCte(filters);
  return runAll(db, cte.sql + `
    SELECT
      ROUND(f.dec_latitude * 2.0) / 2.0 AS lat,
      ROUND(f.dec_longitude * 2.0) / 2.0 AS lng,
      COALESCE(NULLIF(TRIM(f.ev_country), ''), 'UNKNOWN') AS country,
      COALESCE(NULLIF(TRIM(f.ev_state), ''), '') AS state,
      COUNT(*) AS count,
      SUM(${fatalExpr('f')}) AS fatalCount
    FROM filtered_events f
    WHERE
      f.dec_latitude IS NOT NULL AND f.dec_longitude IS NOT NULL AND
      f.dec_latitude BETWEEN -90 AND 90 AND f.dec_longitude BETWEEN -180 AND 180
    GROUP BY lat, lng, country, state
    ORDER BY count DESC
    LIMIT 650
  `, cte.params);
}

function getAircraftBreakdown(filters) {
  const db = getNtsbDb();
  if (!db || !tableExists(db, 'ntsb_aircraft')) {
    return { categories: [], makes: [], models: [], damages: [], ageBuckets: [] };
  }

  const cte = buildFilteredEventsCte(filters);
  const join = ' FROM ntsb_aircraft a INNER JOIN filtered_events f ON f.ev_id = a.ev_id ';

  return {
    categories: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(TRIM(a.acft_category), ''), 'UNKNOWN') AS label, COUNT(*) AS count
      ${join}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    makes: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(UPPER(TRIM(a.acft_make)), ''), 'UNKNOWN') AS label, COUNT(*) AS count
      ${join}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    models: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(UPPER(TRIM(a.acft_model)), ''), 'UNKNOWN') AS label, COUNT(*) AS count
      ${join}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    damages: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(TRIM(a.damage), ''), 'UNKNOWN') AS label, COUNT(*) AS count
      ${join}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    ageBuckets: runAll(db, cte.sql + `
      SELECT
        CASE
          WHEN a.acft_year IS NULL OR a.acft_year <= 0 OR f.ev_year IS NULL THEN '未知'
          WHEN f.ev_year - a.acft_year < 0 THEN '未知'
          WHEN f.ev_year - a.acft_year < 10 THEN '0-9'
          WHEN f.ev_year - a.acft_year < 20 THEN '10-19'
          WHEN f.ev_year - a.acft_year < 30 THEN '20-29'
          WHEN f.ev_year - a.acft_year < 40 THEN '30-39'
          ELSE '40+'
        END AS label,
        COUNT(*) AS count,
        SUM(${fatalExpr('f')}) AS fatalCount
      ${join}
      GROUP BY label
      ORDER BY
        CASE label
          WHEN '0-9' THEN 1 WHEN '10-19' THEN 2 WHEN '20-29' THEN 3
          WHEN '30-39' THEN 4 WHEN '40+' THEN 5 ELSE 6
        END
    `, cte.params),
  };
}

function getWeatherBreakdown(filters) {
  const db = getNtsbDb();
  if (!db) return { light: [], conditions: [], visibility: [], wind: [] };

  const cte = buildFilteredEventsCte(filters);
  return {
    light: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(TRIM(f.light_cond), ''), 'UNKNOWN') AS label, COUNT(*) AS count, SUM(${fatalExpr('f')}) AS fatalCount
      FROM filtered_events f
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    conditions: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(TRIM(f.wx_cond_basic), ''), 'UNKNOWN') AS label, COUNT(*) AS count, SUM(${fatalExpr('f')}) AS fatalCount
      FROM filtered_events f
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    visibility: runAll(db, cte.sql + `
      SELECT
        CASE
          WHEN f.vis_sm IS NULL THEN '未知'
          WHEN f.vis_sm < 1 THEN '<1'
          WHEN f.vis_sm < 3 THEN '1-3'
          WHEN f.vis_sm < 5 THEN '3-5'
          WHEN f.vis_sm < 10 THEN '5-10'
          ELSE '10+'
        END AS label,
        COUNT(*) AS count,
        SUM(${fatalExpr('f')}) AS fatalCount
      FROM filtered_events f
      GROUP BY label
      ORDER BY
        CASE label WHEN '<1' THEN 1 WHEN '1-3' THEN 2 WHEN '3-5' THEN 3 WHEN '5-10' THEN 4 WHEN '10+' THEN 5 ELSE 6 END
    `, cte.params),
    wind: runAll(db, cte.sql + `
      SELECT
        CASE
          WHEN f.wind_vel_kts IS NULL THEN '未知'
          WHEN f.wind_vel_kts < 5 THEN '<5'
          WHEN f.wind_vel_kts < 15 THEN '5-14'
          WHEN f.wind_vel_kts < 25 THEN '15-24'
          WHEN f.wind_vel_kts < 35 THEN '25-34'
          ELSE '35+'
        END AS label,
        COUNT(*) AS count,
        SUM(${fatalExpr('f')}) AS fatalCount
      FROM filtered_events f
      GROUP BY label
      ORDER BY
        CASE label WHEN '<5' THEN 1 WHEN '5-14' THEN 2 WHEN '15-24' THEN 3 WHEN '25-34' THEN 4 WHEN '35+' THEN 5 ELSE 6 END
    `, cte.params),
  };
}

function findingCategoryCase(alias) {
  const col = 'LOWER(COALESCE(' + alias + '.finding_description, \'\'))';
  return `
    CASE
      WHEN ${col} LIKE '%pilot%' OR ${col} LIKE '%personnel%' OR ${col} LIKE '%decision%' OR ${col} LIKE '%fatigue%' THEN '人为因素'
      WHEN ${col} LIKE '%engine%' OR ${col} LIKE '%mechanical%' OR ${col} LIKE '%propeller%' OR ${col} LIKE '%component%' THEN '机械/发动机'
      WHEN ${col} LIKE '%weather%' OR ${col} LIKE '%wind%' OR ${col} LIKE '%visibility%' OR ${col} LIKE '%icing%' THEN '天气/环境'
      WHEN ${col} LIKE '%approach%' OR ${col} LIKE '%landing%' OR ${col} LIKE '%runway%' OR ${col} LIKE '%flare%' THEN '进近/着陆'
      WHEN ${col} LIKE '%loss of control%' OR ${col} LIKE '%stall%' OR ${col} LIKE '%spin%' THEN '失控'
      WHEN ${col} LIKE '%maintenance%' OR ${col} LIKE '%inspection%' OR ${col} LIKE '%repair%' THEN '维护'
      WHEN ${col} LIKE '%fuel%' THEN '燃油'
      WHEN ${col} LIKE '%communication%' OR ${col} LIKE '%atc%' OR ${col} LIKE '%clearance%' THEN '通信/管制'
      WHEN ${col} LIKE '%training%' OR ${col} LIKE '%instruction%' THEN '训练'
      ELSE '其他'
    END
  `;
}

function getFindingBreakdown(filters) {
  const db = getNtsbDb();
  if (!db || !tableExists(db, 'ntsb_findings')) {
    return { categories: [], topFindings: [], severityMatrix: [] };
  }

  const cte = buildFilteredEventsCte(filters);
  const categoryCase = findingCategoryCase('fi');

  return {
    categories: runAll(db, cte.sql + `
      SELECT ${categoryCase} AS label, COUNT(*) AS count
      FROM ntsb_findings fi
      INNER JOIN filtered_events f ON f.ev_id = fi.ev_id
      WHERE NULLIF(TRIM(COALESCE(fi.finding_description, '')), '') IS NOT NULL
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    topFindings: runAll(db, cte.sql + `
      SELECT COALESCE(NULLIF(TRIM(fi.finding_description), ''), 'UNKNOWN') AS label, COUNT(*) AS count
      FROM ntsb_findings fi
      INNER JOIN filtered_events f ON f.ev_id = fi.ev_id
      WHERE NULLIF(TRIM(COALESCE(fi.finding_description, '')), '') IS NOT NULL
      GROUP BY label
      ORDER BY count DESC
      LIMIT 12
    `, cte.params),
    severityMatrix: runAll(db, cte.sql + `
      SELECT ${categoryCase} AS category, ${severityExpr('f')} AS severity, COUNT(*) AS count
      FROM ntsb_findings fi
      INNER JOIN filtered_events f ON f.ev_id = fi.ev_id
      WHERE NULLIF(TRIM(COALESCE(fi.finding_description, '')), '') IS NOT NULL
      GROUP BY category, severity
      ORDER BY category, count DESC
    `, cte.params),
  };
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
};

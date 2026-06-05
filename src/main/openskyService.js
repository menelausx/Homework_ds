const https = require('https');
const cacheService = require('./cacheService');

const OPENSKY_CACHE_FILE = 'opensky-cache.json';
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';

function fetchOpenSkyData() {
  return new Promise((resolve, reject) => {
    https
      .get(
        OPENSKY_API_URL,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DataSecurityApp/1.0)',
          },
          timeout: 60000,
        },
        (response) => {
          if (response.statusCode !== 200) {
            return reject(
              new Error('OpenSky API returned status ' + response.statusCode)
            );
          }

          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });

          response.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (err) {
              reject(new Error('Failed to parse OpenSky response: ' + err.message));
            }
          });
        }
      )
      .on('error', reject);
  });
}

function convertStatesToObjects(rawData) {
  if (!rawData || !rawData.states || !Array.isArray(rawData.states)) {
    return { time: rawData && rawData.time ? rawData.time : 0, cacheTime: null, states: [] };
  }

  const states = rawData.states
    .filter((state) => state[5] != null && state[6] != null)
    .map((state) => ({
      icao24: (state[0] || '').toLowerCase().trim(),
      callsign: (state[1] || '').trim(),
      origin_country: state[2] || '',
      time_position: state[3] || 0,
      last_contact: state[4] || 0,
      longitude: state[5],
      latitude: state[6],
      baro_altitude: state[7],
      on_ground: state[8],
      velocity: state[9],
      true_track: state[10],
      vertical_rate: state[11],
      sensors: state[12],
      geo_altitude: state[13],
      squawk: state[14],
      spi: state[15],
      position_source: state[16],
    }));

  return {
    time: rawData.time || 0,
    cacheTime: new Date().toISOString(),
    states,
  };
}

function getCachedFlights() {
  const cached = cacheService.readJsonFile(OPENSKY_CACHE_FILE);
  if (cached && cached.states) {
    return cached;
  }
  return { time: 0, cacheTime: null, states: [] };
}

async function refresh() {
  const rawData = await fetchOpenSkyData();
  const processed = convertStatesToObjects(rawData);

  cacheService.writeJsonFile(OPENSKY_CACHE_FILE, processed);
  console.log('OpenSky data refreshed: ' + processed.states.length + ' flights');

  return processed;
}

module.exports = { getCachedFlights, refresh, fetchOpenSkyData, convertStatesToObjects };

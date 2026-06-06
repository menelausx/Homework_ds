'use strict';

const https = require('https');

const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';

function fetchOpenSkyData() {
  return new Promise((resolve, reject) => {
    const request = https.get(OPENSKY_API_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataSecurityApp/1.0)' },
      timeout: 60000,
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('OpenSky API returned status ' + response.statusCode));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        try {
          resolve(JSON.parse(body.toString('utf8')));
        } catch (_error) {
          reject(new Error('OpenSky response was not valid JSON'));
        } finally {
          body.fill(0);
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('OpenSky request timed out')));
  });
}

module.exports = { fetchOpenSkyData };

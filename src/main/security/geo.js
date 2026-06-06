'use strict';

function parseCoordinate(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isUsableCoordinatePair(latitude, longitude) {
  return latitude != null
    && longitude != null
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

module.exports = { parseCoordinate, isUsableCoordinatePair };

'use strict';

function aircraftAge(eventYear, aircraftYear) {
  const age = Number(eventYear) - Number(aircraftYear);
  if (!Number.isFinite(age) || age < 0) return '未知';
  if (age < 10) return '0-9';
  if (age < 20) return '10-19';
  if (age < 30) return '20-29';
  if (age < 40) return '30-39';
  return '40+';
}

function visibility(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '未知';
  if (number < 1) return '<1';
  if (number < 3) return '1-3';
  if (number < 5) return '3-5';
  if (number < 10) return '5-10';
  return '10+';
}

function wind(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '未知';
  if (number < 5) return '<5';
  if (number < 15) return '5-14';
  if (number < 25) return '15-24';
  if (number < 35) return '25-34';
  return '35+';
}

module.exports = { aircraftAge, visibility, wind };

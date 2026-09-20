'use strict';
const { DEFAULTS } = require('../../main/config');

function createMemoryConfig(initial = {}) {
  let data = JSON.parse(JSON.stringify({ ...DEFAULTS, ...initial }));
  return {
    filePath: ':memory:',
    get: () => JSON.parse(JSON.stringify(data)),
    set(patch) { data = { ...data, ...JSON.parse(JSON.stringify(patch)) }; return JSON.parse(JSON.stringify(data)); },
  };
}

module.exports = { createMemoryConfig };

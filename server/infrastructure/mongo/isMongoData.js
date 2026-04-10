const { getMongoEnv } = require('./mongoEnv');

/**
 * @returns {boolean}
 */
function isMongoDataBackend() {
  return process.env.DATA_BACKEND === 'mongo' && !!(getMongoEnv().uri || '').trim();
}

module.exports = { isMongoDataBackend };

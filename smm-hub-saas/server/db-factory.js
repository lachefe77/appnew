const config = require('./config');
const logger = require('./logger');

/**
 * Factory pattern: hoje expõe SQLite (prod-ready).
 * Para migrar pra Postgres: implemente adapter com mesma API em ./db-pg.js
 * e troque DB_DRIVER=postgres em .env.
 */
function createDbDriver() {
  if (config.db.driver === 'postgres') {
    logger.warn('[db-factory] Postgres driver: scaffold presente, requer `pg` instalado e ./db-pg.js completo. Usando SQLite por ora.');
  }
  return require('./db');
}

module.exports = createDbDriver();

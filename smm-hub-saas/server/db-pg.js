/**
 * 41. Postgres driver scaffold.
 * Para ativar: npm i pg, defina DB_DRIVER=postgres + PG_* no .env.
 * Esta implementação espelha a API de ./db.js (prepare().run/get/all).
 */
module.exports = {
  note: 'PG scaffold — implementar quando migrar. Mantém mesma API: db.prepare().run/get/all + tx() + hashPassword etc.',
  migration_sql_path: './server/migrations/postgres-schema.sql'
};

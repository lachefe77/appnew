const logger = require('./logger');

/**
 * Scaffolds para Sentry (34) e OpenTelemetry (35).
 * Habilite instalando sentry/node + @opentelemetry/sdk-node e configurando DSN em .env.
 */

let sentry = null;
try {
  if (process.env.SENTRY_DSN) {
    sentry = require('@sentry/node');
    sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, tracesSampleRate: 0.1 });
    logger.info('[observability] Sentry inicializado.');
  }
} catch (e) {
  logger.debug('[observability] @sentry/node não instalado. `npm i @sentry/node` para ativar.');
}

function captureException(err, extra) {
  if (sentry) sentry.captureException(err, { extra });
  logger.error({ err: err.message, extra }, 'exception');
}

function captureMessage(message, level = 'info') {
  if (sentry) sentry.captureMessage(message, level);
  logger[level === 'error' ? 'error' : 'info']({ event: 'captured_message' }, message);
}

/* OpenTelemetry: span helper leve */
function withSpan(name, fn) {
  const t0 = Date.now();
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => logger.debug({ span: name, ms: Date.now() - t0 }, 'span'));
    }
    logger.debug({ span: name, ms: Date.now() - t0 }, 'span');
    return result;
  } catch (err) {
    captureException(err, { span: name });
    throw err;
  }
}

module.exports = { captureException, captureMessage, withSpan };

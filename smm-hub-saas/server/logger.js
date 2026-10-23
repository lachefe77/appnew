const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'password',
      'token',
      'api_key',
      'authorization',
      'headers.authorization',
      'req.headers.authorization',
      '*.password',
      '*.api_key',
      '*.accessToken',
      '*.webhookSecret',
      '*.ipnSecret',
    ],
    censor: '[redacted]',
  },
  transport:
    config.env === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

module.exports = logger;

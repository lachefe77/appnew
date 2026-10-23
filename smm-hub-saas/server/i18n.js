const i18next = require('i18next');
const FsBackend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');
const path = require('node:path');

async function initI18n() {
  await i18next.use(FsBackend).use(middleware.LanguageDetector).init({
    fallbackLng: 'pt',
    preload: ['pt', 'en', 'es'],
    ns: ['common'],
    defaultNS: 'common',
    backend: { loadPath: path.join(__dirname, 'locales', '{{lng}}', '{{ns}}.json') },
    detection: {
      order: ['querystring', 'cookie', 'header'],
      lookupQuerystring: 'lng',
      lookupCookie: 'lng',
      caches: ['cookie']
    }
  });
  return middleware.handle(i18next);
}

module.exports = { initI18n, i18next };

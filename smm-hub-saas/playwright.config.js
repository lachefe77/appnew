const baseURL=process.env.BASE_URL||'http://127.0.0.1:4179';
module.exports = {
  testDir: './tests-e2e',
  timeout: 30000,
  workers: 1,
  webServer: {command:'node scripts/e2e-server.cjs',url:baseURL+'/health',reuseExistingServer:false,timeout:30000},
  use: {
    baseURL,
    launchOptions:process.platform==='win32'?{executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{},
    headless: true,
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } }
  ]
};

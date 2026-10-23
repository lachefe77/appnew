// 36. k6 load test — rode: k6 run scripts/k6-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
  },
};

const BASE = __ENV.BASE || 'http://localhost:3000';

export default function () {
  const r1 = http.get(`${BASE}/health`);
  check(r1, { 'health 200': (r) => r.status === 200 });

  const r2 = http.get(`${BASE}/api/services`);
  check(r2, { 'services 200': (r) => r.status === 200 });

  const r3 = http.get(`${BASE}/api/announcements/active`);
  check(r3, { 'announcement 200': (r) => r.status === 200 });

  sleep(1);
}

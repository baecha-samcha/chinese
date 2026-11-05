export default {
 testDir: '/home/baecha/ch/tests/browser',
 testMatch: 'match.spec.js',
 workers: 1,
 timeout: 90000,
 expect: { timeout: 30000 },
 use: { baseURL: 'https://ch.baecha.xyz', headless: true },
 reporter: 'list'
};

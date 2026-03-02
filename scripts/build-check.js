const fs = require('fs');
const required = [
  'backend/server.js',
  'backend/scoring.js',
  'backend/store.js',
  'web/index.html',
  'worker/daily-score.js',
  'db/schema.sql',
  'README.md',
  '.env.example'
];
for (const file of required) {
  if (!fs.existsSync(require('path').join(__dirname, '..', file))) {
    console.error('Missing required file:', file);
    process.exit(1);
  }
}
console.log('market-rank build check passed');

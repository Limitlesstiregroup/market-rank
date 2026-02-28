const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    if (item === 'data' || item === 'node_modules' || item.startsWith('.git')) continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (item.endsWith('.js')) files.push(full);
  }
})(root);
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  if (txt.includes('\t')) {
    console.error('Tab indentation found:', path.relative(root, f));
    process.exit(1);
  }
}
console.log('market-rank lint check passed');

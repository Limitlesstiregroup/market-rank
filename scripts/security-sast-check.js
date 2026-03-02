const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];
const scanRoots = ['backend', 'worker'];

for (const scanRoot of scanRoots) {
  const base = path.join(root, scanRoot);
  if (!fs.existsSync(base)) continue;
  walk(base);
}

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    if (item === 'node_modules' || item.startsWith('.git')) continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (item.endsWith('.js')) {
      files.push(full);
    }
  }
}

const rules = [
  {
    id: 'no-eval',
    regex: /\beval\s*\(/,
    message: 'Avoid eval().',
  },
  {
    id: 'no-function-constructor',
    regex: /\bnew\s+Function\s*\(/,
    message: 'Avoid Function constructor.',
  },
  {
    id: 'no-shell-exec',
    regex: /\b(exec|execSync|spawn|spawnSync)\s*\(/,
    message: 'Review shell execution usage.',
  },
];

const findings = [];

for (const file of files) {
  const rel = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);

  lines.forEach((line, idx) => {
    for (const rule of rules) {
      if (rule.regex.test(line)) {
        findings.push({
          file: rel,
          line: idx + 1,
          rule: rule.id,
          message: rule.message,
          snippet: line.trim(),
        });
      }
    }
  });
}

if (findings.length) {
  console.error('SAST check failed with findings:');
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} -> ${finding.snippet}`
    );
  }
  process.exit(1);
}

console.log('market-rank sast check passed');

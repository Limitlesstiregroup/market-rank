const fs = require('fs');
const path = require('path');

function getMigrationFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

async function ensureMeta(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for migrations');
  }

  const { Client } = require('pg');
  const client = new Client({
    connectionString: databaseUrl,
    ssl: String(process.env.PGSSL || '').trim().toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : undefined
  });

  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  const migrations = getMigrationFiles(migrationsDir);

  await client.connect();
  try {
    await ensureMeta(client);
    const result = await client.query('SELECT filename FROM schema_migrations ORDER BY filename ASC');
    const applied = new Set(result.rows.map((row) => row.filename));

    for (const filename of migrations) {
      if (applied.has(filename)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }

    console.log('Migration run complete');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

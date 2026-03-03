const fs = require('fs');
const path = require('path');

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
    throw new Error('DATABASE_URL is required for rollback');
  }

  const { Client } = require('pg');
  const client = new Client({
    connectionString: databaseUrl,
    ssl: String(process.env.PGSSL || '').trim().toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : undefined
  });

  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

  await client.connect();
  try {
    await ensureMeta(client);
    const result = await client.query('SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1');
    const latest = result.rows[0]?.filename;
    if (!latest) {
      console.log('No applied migrations to roll back');
      return;
    }

    const downFile = latest.replace(/\.sql$/, '.down.sql');
    const downPath = path.join(migrationsDir, downFile);
    if (!fs.existsSync(downPath)) {
      throw new Error(`Rollback file missing: ${downFile}`);
    }

    const sql = fs.readFileSync(downPath, 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE filename = $1', [latest]);
      await client.query('COMMIT');
      console.log(`Rolled back migration: ${latest}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

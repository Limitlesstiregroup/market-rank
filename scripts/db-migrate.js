const fs = require('fs');
const path = require('path');

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

  const migrationFile = path.join(__dirname, '..', 'db', 'migrations', '001_app_state.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Applied migration: 001_app_state.sql');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

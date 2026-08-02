import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { resolveMigrationsDirectory } from './migration-path.js';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL obbligatoria per le migrazioni.');
const moduleName = 'pg';
const imported = await import(moduleName) as { Client: new (options: Record<string, unknown>) => {
  connect(): Promise<void>;
  query(text: string): Promise<unknown>;
  end(): Promise<void>;
} };
const client = new imported.Client({ connectionString: config.databaseUrl });
const migrationsDir = resolveMigrationsDirectory();
const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of files) {
    const escaped = file.replaceAll("'", "''");
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      const check = await client.query(`SELECT 1 FROM schema_migrations WHERE name='${escaped}'`) as { rows?: unknown[] };
      if (!check.rows?.length) {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ('${escaped}')`);
        console.log(`Applied ${file}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

/**
 * Applies the canonical schema on boot (synchronize=true style). The DDL is all
 * IF NOT EXISTS, so this is safe to run on every start in dev.
 */
export async function synchronizeSchema(): Promise<void> {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'northwind',
    password: process.env.PGPASSWORD || 'northwind',
    database: process.env.PGDATABASE || 'northwind',
  });
  try {
    const candidates = [
      path.join(process.cwd(), 'db', 'schema.sql'),
      path.join(__dirname, '..', '..', 'db', 'schema.sql'),
      path.join(__dirname, '..', '..', '..', 'db', 'schema.sql'),
    ];
    const schemaPath = candidates.find((p) => fs.existsSync(p));
    if (!schemaPath) {
      throw new Error('schema.sql not found (looked in: ' + candidates.join(', ') + ')');
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

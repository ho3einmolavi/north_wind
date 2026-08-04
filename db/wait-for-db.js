// Blocks until Postgres accepts connections, then exits 0.
const { Client } = require('pg');

const cfg = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'northwind',
  password: process.env.PGPASSWORD || 'northwind',
  database: process.env.PGDATABASE || 'northwind',
};

async function wait() {
  for (let i = 0; i < 60; i++) {
    const client = new Client(cfg);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log('postgres is ready');
      return;
    } catch (e) {
      await client.end().catch(() => null);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error('postgres did not become ready in time');
  process.exit(1);
}

wait();

import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'northwind',
  password: process.env.PGPASSWORD || 'northwind',
  database: process.env.PGDATABASE || 'northwind',
});

// Fixed UUIDs so reproduce_bugs.sh and the README can reference exact rows.
const IDS = {
  host1: '11111111-1111-1111-1111-111111111111',
  host2: '22222222-2222-2222-2222-222222222222',
  guest1: '33333333-3333-3333-3333-333333333333',
  guest2: '44444444-4444-4444-4444-444444444444',
  eventHeld: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  eventReleased: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  paymentHeld: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  paymentReleased: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
};

const TOKENS = {
  host1: 'token-host1',
  host2: 'token-host2',
  guest1: 'token-guest1',
  guest2: 'token-guest2',
};

async function run() {
  await pool.query('BEGIN');

  // Idempotent reseed.
  await pool.query('DELETE FROM attendee_count_events');
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM attendances');
  await pool.query('DELETE FROM auth_sessions');
  await pool.query('DELETE FROM events');
  await pool.query('DELETE FROM users');

  await pool.query(
    `INSERT INTO users (id, email, display_name, role) VALUES
       ($1, 'host1@northwind.test', 'Host One', 'host'),
       ($2, 'host2@northwind.test', 'Host Two', 'host'),
       ($3, 'guest1@northwind.test', 'Guest One', 'guest'),
       ($4, 'guest2@northwind.test', 'Guest Two', 'guest')`,
    [IDS.host1, IDS.host2, IDS.guest1, IDS.guest2],
  );

  await pool.query(
    `INSERT INTO auth_sessions (user_id, token) VALUES
       ($1, $5), ($2, $6), ($3, $7), ($4, $8)`,
    [
      IDS.host1,
      IDS.host2,
      IDS.guest1,
      IDS.guest2,
      TOKENS.host1,
      TOKENS.host2,
      TOKENS.guest1,
      TOKENS.guest2,
    ],
  );

  // Event with an in-flight HELD payment of $40.00 (4000 cents).
  await pool.query(
    `INSERT INTO events (id, host_id, title, price_cents, currency, status, attendee_count)
     VALUES ($1, $2, 'Rooftop Sunset Mixer', 4000, 'usd', 'open', 1)`,
    [IDS.eventHeld, IDS.host1],
  );
  await pool.query(
    `INSERT INTO attendances (event_id, guest_id, checked_in) VALUES ($1, $2, false)`,
    [IDS.eventHeld, IDS.guest1],
  );
  await pool.query(
    `INSERT INTO payments
       (id, event_id, guest_id, host_id, amount_cents, currency, status, provider_charge_id)
     VALUES ($1, $2, $3, $4, 4000, 'usd', 'held', 'ch_seed_held_001')`,
    [IDS.paymentHeld, IDS.eventHeld, IDS.guest1, IDS.host1],
  );

  // Event that is already RELEASED / paid out ($25.00).
  await pool.query(
    `INSERT INTO events (id, host_id, title, price_cents, currency, status, attendee_count)
     VALUES ($1, $2, 'Morning Trail Run', 2500, 'usd', 'completed', 1)`,
    [IDS.eventReleased, IDS.host2],
  );
  await pool.query(
    `INSERT INTO attendances (event_id, guest_id, checked_in) VALUES ($1, $2, true)`,
    [IDS.eventReleased, IDS.guest2],
  );
  await pool.query(
    `INSERT INTO payments
       (id, event_id, guest_id, host_id, amount_cents, currency, status, provider_charge_id)
     VALUES ($1, $2, $3, $4, 2500, 'usd', 'paid_out', 'ch_seed_released_001')`,
    [IDS.paymentReleased, IDS.eventReleased, IDS.guest2, IDS.host2],
  );

  await pool.query('COMMIT');

  console.log('Seed complete.');
  console.log('  held event   :', IDS.eventHeld, '(payment', IDS.paymentHeld, '$40.00 held)');
  console.log('  released event:', IDS.eventReleased, '($25.00 paid_out)');
  console.log('  tokens       :', JSON.stringify(TOKENS));
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await pool.query('ROLLBACK').catch(() => null);
    await pool.end();
    process.exit(1);
  });

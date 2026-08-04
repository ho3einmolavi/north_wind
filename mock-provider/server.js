// Mock payment provider.
//   POST /charges            -> creates a charge "hold", returns { chargeId, status }
//   then emits a signed       POST {APP_WEBHOOK_URL}  (charge.settled)
// The webhook body is signed with HMAC-SHA256 over the raw JSON using
// PAYMENT_WEBHOOK_SECRET, in header `x-nw-signature`.
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4000', 10);
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_dev';
const APP_WEBHOOK_URL =
  process.env.APP_WEBHOOK_URL || 'http://localhost:3000/webhooks/payment';

function sign(rawBody) {
  return crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

async function emitWebhook(charge) {
  const event = {
    id: `evt_${crypto.randomBytes(8).toString('hex')}`,
    type: 'charge.settled',
    data: {
      chargeId: charge.chargeId,
      amountCents: charge.amountCents,
    },
  };
  const raw = JSON.stringify(event);
  const signature = sign(raw);
  try {
    await fetch(APP_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nw-signature': signature },
      body: raw,
    });
    console.log(`webhook emitted event=${event.id} charge=${charge.chargeId}`);
  } catch (e) {
    console.error('webhook emit failed', e.message);
  }
}

app.post('/charges', async (req, res) => {
  const amountCents = req.body.amountCents;
  const currency = req.body.currency || 'usd';
  const charge = {
    chargeId: `ch_${crypto.randomBytes(8).toString('hex')}`,
    amountCents,
    currency,
    status: 'requires_capture',
  };
  res.json({ chargeId: charge.chargeId, status: charge.status });

  // Settle shortly after, as a real provider would, and notify the app.
  setTimeout(() => emitWebhook(charge), 250);
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`mock payment provider on :${PORT}, webhook -> ${APP_WEBHOOK_URL}`);
});

import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

let server;
let baseUrl;
const allowedOrigin = 'http://localhost:5173';
const paystackSecret = 'sk_test_render_api_unit_test';

before(async () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: 'demo-render-api-test',
    client_email: 'render-api-test@demo-render-api-test.iam.gserviceaccount.com',
    private_key: privateKey,
  });
  process.env.PAYSTACK_SECRET_KEY = paystackSecret;
  process.env.ALLOWED_ORIGINS = allowedOrigin;
  const { createRenderServer } = await import('../functions/render-server.js');
  server = createRenderServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
});

test('health endpoint responds without Firebase or payment credentials in the request', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('order API preflight allows the configured storefront origin and bearer auth', async () => {
  const response = await fetch(`${baseUrl}/api/orders/initialize`, {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
});

test('order API rejects unapproved storefront origins', async () => {
  const response = await fetch(`${baseUrl}/api/orders/initialize`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unapproved.example',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(response.status, 403);
});

test('order initialization keeps server-side validation errors explicit', async () => {
  const response = await fetch(`${baseUrl}/api/orders/initialize`, {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  const result = await response.json();
  assert.equal(result.error, 'invalid-argument');
  assert.match(result.message, /valid delivery details/i);
});

test('administrator API routes require a Firebase sign-in token', async () => {
  const response = await fetch(`${baseUrl}/api/admin/orders/status`, {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'TPN-20260101-A1B2C3D4', status: 'delivered' }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, 'Sign in to continue.');
});

test('welcome SMS endpoint requires the account owner to be signed in', async () => {
  const response = await fetch(`${baseUrl}/api/account/welcome-sms`, {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, 'Sign in to continue.');
});

test('Paystack webhook rejects bad signatures and ignores signed unrelated events', async () => {
  const rawBody = Buffer.from(JSON.stringify({ event: 'transfer.success', data: {} }));
  const rejected = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'bad' },
    body: rawBody,
  });
  assert.equal(rejected.status, 401);

  const signature = createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
  const accepted = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
    body: rawBody,
  });
  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), 'Ignored');
});

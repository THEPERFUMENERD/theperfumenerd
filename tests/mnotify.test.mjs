import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSmsRecipient, selectOrderSmsPhone, sendMnotifySms } from '../functions/mnotify.js';

test('normalizes Ghana mobile numbers for mNotify', () => {
  assert.equal(normalizeSmsRecipient('024 123 4567'), '0241234567');
  assert.equal(normalizeSmsRecipient('+233 24 123 4567'), '0241234567');
  assert.equal(normalizeSmsRecipient('233241234567'), '0241234567');
  assert.throws(() => normalizeSmsRecipient('123'), /valid Ghanaian mobile number/i);
  assert.throws(() => normalizeSmsRecipient('0505573287dfefeiffefef'), /valid Ghanaian mobile number/i);
  assert.throws(() => normalizeSmsRecipient('+12025550123'), /valid Ghanaian mobile number/i);
});

test('prefers the latest account phone over the checkout phone for order SMS', () => {
  assert.equal(selectOrderSmsPhone('  0241234567  ', '0201234567'), '0241234567');
  assert.equal(selectOrderSmsPhone('', '0201234567'), '0201234567');
});

test('sends an SMS using the configured sender and server API key', async () => {
  let requestUrl;
  let requestOptions;
  const result = await sendMnotifySms({
    phone: '024 123 4567',
    message: 'Welcome.',
    apiKey: 'server-test-key',
    senderId: 'PerfumeNerd',
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    },
  });

  assert.match(requestUrl, /^https:\/\/api\.mnotify\.com\/api\/sms\/quick\?key=server-test-key$/);
  assert.equal(requestOptions.method, 'POST');
  assert.deepEqual(JSON.parse(requestOptions.body), {
    recipient: ['0241234567'],
    sender: 'PerfumeNerd',
    message: 'Welcome.',
    is_schedule: false,
    schedule_date: '',
  });
  assert.deepEqual(result, { status: 'success' });
});

test('uses the PerfumeNerd sender ID when none is provided', async () => {
  let requestOptions;
  await sendMnotifySms({
    phone: '0241234567',
    message: 'Welcome.',
    apiKey: 'server-test-key',
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    },
  });

  assert.equal(JSON.parse(requestOptions.body).sender, 'PerfumeNerd');
});

test('does not send with a missing key or invalid sender ID', async () => {
  await assert.rejects(sendMnotifySms({
    phone: '0241234567',
    message: 'Welcome.',
    apiKey: '',
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  }), /not configured/i);

  await assert.rejects(sendMnotifySms({
    phone: '0241234567',
    message: 'Welcome.',
    apiKey: 'server-test-key',
    senderId: 'PERFUME NERD STORE',
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  }), /sender ID/i);
});

test('reports mNotify HTTP and provider failures', async () => {
  await assert.rejects(sendMnotifySms({
    phone: '0241234567',
    message: 'Welcome.',
    apiKey: 'server-test-key',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => null }),
  }), /HTTP 503/);

  await assert.rejects(sendMnotifySms({
    phone: '0241234567',
    message: 'Welcome.',
    apiKey: 'server-test-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'failure', code: '4001', message: 'Sender ID not approved' }),
    }),
  }), /HTTP 200\): 4001: Sender ID not approved/);
});

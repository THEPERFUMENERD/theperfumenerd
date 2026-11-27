import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-perfume-nerd';
const adminEmail = 'asiedud41@gmail.com';
const adminPassword = `TpnTest-${randomUUID()}-A1!`;
const customerEmail = `customer-${randomUUID()}@example.test`;
const customerPassword = `TpnTest-${randomUUID()}-A1!`;
let app;
let adminAuth;
let db;
let adminUid;
let customerUid;
let adminToken;
let customerToken;
const productId = `pos-test-${randomUUID()}`;
const saleId = randomUUID();

async function signIn(email, password) {
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await response.json();
  assert.equal(response.ok, true, `Auth emulator sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function requestSale(token, payload) {
  const response = await fetch(
    'http://127.0.0.1:5001/demo-perfume-nerd/us-central1/completePosCashSale',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: payload }),
    },
  );
  return { status: response.status, body: await response.json() };
}

before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = getApps()[0] ?? initializeApp({ projectId });
  adminAuth = getAuth(app);
  db = getFirestore(app);

  const adminUser = await adminAuth.createUser({
    email: adminEmail,
    password: adminPassword,
    emailVerified: true,
  });
  const customer = await adminAuth.createUser({
    email: customerEmail,
    password: customerPassword,
    emailVerified: true,
  });
  await adminAuth.setCustomUserClaims(customer.uid, { admin: true });
  adminUid = adminUser.uid;
  customerUid = customer.uid;
  adminToken = await signIn(adminEmail, adminPassword);
  customerToken = await signIn(customerEmail, customerPassword);
  await db.collection('products').doc(productId).set({
    name: 'POS Test Fragrance',
    brand: 'Test House',
    price: 1200,
    stock: 3,
    visible: true,
    image: '',
  });
});

after(async () => {
  if (db) {
    await db.collection('products').doc(productId).delete();
    await db.collection('sales').doc(saleId).delete();
    const movements = await db.collection('inventoryMovements').where('referenceId', '==', saleId).get();
    await Promise.all(movements.docs.map((movement) => movement.ref.delete()));
  }
  if (adminUid) await adminAuth.deleteUser(adminUid);
  if (customerUid) await adminAuth.deleteUser(customerUid);
  if (app) await app.delete();
});

test('cash sale validates authority and tender, then atomically deducts stock exactly once', async () => {
  const payload = {
    idempotencyKey: saleId,
    items: [{ productId, quantity: 2 }],
    amountReceivedMinor: 250000,
    customer: { name: 'Walk-in Customer', phone: '' },
  };

  const first = await requestSale(adminToken, payload);
  assert.equal(first.status, 200);
  assert.equal(first.body.result.totalMinor, 240000);
  assert.equal(first.body.result.changeMinor, 10000);
  assert.match(first.body.result.receiptNumber, /^TPN-\d{8}-[A-F0-9]{8}$/);

  const duplicate = await requestSale(adminToken, payload);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.result.saleId, saleId);
  assert.equal((await db.collection('products').doc(productId).get()).data().stock, 1);
  assert.equal((await db.collection('inventoryMovements').where('referenceId', '==', saleId).get()).size, 1);

  const changedReplay = await requestSale(adminToken, {
    ...payload,
    amountReceivedMinor: 260000,
  });
  assert.equal(changedReplay.body.error.status, 'ALREADY_EXISTS');
  assert.equal((await db.collection('products').doc(productId).get()).data().stock, 1);

  const insufficient = await requestSale(adminToken, {
    ...payload,
    idempotencyKey: randomUUID(),
    amountReceivedMinor: 1,
  });
  assert.equal(insufficient.body.error.status, 'FAILED_PRECONDITION');
  assert.equal((await db.collection('products').doc(productId).get()).data().stock, 1);

  const oversell = await requestSale(adminToken, {
    ...payload,
    idempotencyKey: randomUUID(),
    items: [{ productId, quantity: 2 }],
  });
  assert.equal(oversell.body.error.status, 'FAILED_PRECONDITION');
  assert.equal((await db.collection('products').doc(productId).get()).data().stock, 1);

  const unauthorized = await requestSale(customerToken, {
    ...payload,
    idempotencyKey: randomUUID(),
  });
  assert.equal(unauthorized.body.error.status, 'PERMISSION_DENIED');
  assert.equal((await db.collection('products').doc(productId).get()).data().stock, 1);

});

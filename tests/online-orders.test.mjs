import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateOnlineOrderItems, generateOnlineOrderId, isValidOnlineOrderId, validateOnlineOrder } from '../functions/index.js';

const productSnapshot = (data) => ({ exists: true, data: () => data });
const customer = {
  name: 'Scent Lover',
  email: 'buyer@example.com',
  phone: '+233 20 000 0000',
  address: '12 Sample Street',
  city: 'Accra',
  region: 'Greater Accra',
  postalCode: '',
};
const product = {
  name: 'Signature Eau de Parfum',
  brand: 'Perfume House',
  price: 341.56,
  stock: 5,
  visible: true,
  image: 'https://example.test/perfume.jpg',
};

test('checkout accepts bounded customer data and normalized product quantities', () => {
  const result = validateOnlineOrder({
    customer: { ...customer, email: '  BUYER@example.com ' },
    items: [{ productId: 'signature', quantity: 2 }],
  });
  assert.equal(result.customer.email, 'buyer@example.com');
  assert.deepEqual(result.items, [{ productId: 'signature', quantity: 2 }]);
});

test('new short order IDs and legacy order IDs remain valid', () => {
  const generated = generateOnlineOrderId();
  assert.match(generated, /^TPN-[A-F0-9]{7}$/);
  assert.equal(isValidOnlineOrderId(generated), true);
  assert.equal(isValidOnlineOrderId('TPN-08F74DE'), true);
  assert.equal(isValidOnlineOrderId('TPN-20261117-0DB015E7842DF2269C4730051C3E9546'), true);
  assert.equal(isValidOnlineOrderId('TPN-TOO-LONG'), false);
});

test('checkout rejects repeated lines, invalid quantities and incomplete delivery details', () => {
  assert.throws(() => validateOnlineOrder({
    customer,
    items: [{ productId: 'signature', quantity: 1 }, { productId: 'signature', quantity: 2 }],
  }), { code: 'invalid-argument' });
  assert.throws(() => validateOnlineOrder({
    customer,
    items: [{ productId: 'signature', quantity: 0 }],
  }), { code: 'invalid-argument' });
  assert.throws(() => validateOnlineOrder({
    customer: { ...customer, address: '' },
    items: [{ productId: 'signature', quantity: 1 }],
  }), { code: 'invalid-argument' });
});

test('server prices active all-product discounts in whole Ghana cedis', () => {
  const items = calculateOnlineOrderItems(
    [{ productId: 'signature', quantity: 2 }],
    new Map([['signature', productSnapshot(product)]]),
    { discountMode: 'all', discountPercentage: 15 },
  );
  assert.equal(items[0].unitPriceMinor, 29000);
  assert.equal(items[0].originalUnitPriceMinor, 34156);
  assert.equal(items[0].lineTotalMinor, 58000);
});

test('server uses selected sale price and ignores invalid or inactive sale settings', () => {
  const selected = calculateOnlineOrderItems(
    [{ productId: 'signature', quantity: 1 }],
    new Map([['signature', productSnapshot(product)]]),
    { discountMode: 'selected', discountProducts: [{ productId: 'signature', salePrice: 299 }] },
  );
  const inactive = calculateOnlineOrderItems(
    [{ productId: 'signature', quantity: 1 }],
    new Map([['signature', productSnapshot(product)]]),
    { discountMode: 'none', discountPercentage: 80 },
  );
  assert.equal(selected[0].unitPriceMinor, 29900);
  assert.equal(inactive[0].unitPriceMinor, 34156);
});

test('server rejects hidden, missing and insufficient-stock products', () => {
  assert.throws(() => calculateOnlineOrderItems(
    [{ productId: 'hidden', quantity: 1 }],
    new Map([['hidden', productSnapshot({ ...product, visible: false })]]),
  ), { code: 'failed-precondition' });
  assert.throws(() => calculateOnlineOrderItems(
    [{ productId: 'missing', quantity: 1 }],
    new Map(),
  ), { code: 'not-found' });
  assert.throws(() => calculateOnlineOrderItems(
    [{ productId: 'signature', quantity: 6 }],
    new Map([['signature', productSnapshot(product)]]),
  ), { code: 'failed-precondition' });
});

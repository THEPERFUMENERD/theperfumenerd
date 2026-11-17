import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPosCustomerDisplaySessionId, getStorefrontPath, getStorefrontTab } from '../src/routes.ts';

test('Paystack returns at storefront root open the Orders view', () => {
  assert.equal(getStorefrontTab('/', '?trxref=TPN-20261117-ORDER&reference=TPN-20261117-ORDER'), 'Orders');
  assert.equal(getStorefrontTab('/', '?reference=TPN-20261117-ORDER'), 'Orders');
});

test('Paystack return URL is moved to the Orders route after the SPA loads', () => {
  assert.equal(getStorefrontPath('/', '?trxref=TPN-ORDER&reference=TPN-ORDER'), '/orders');
  assert.equal(getStorefrontPath('/orders', '?reference=TPN-ORDER'), '/orders');
});

test('normal storefront routes keep their existing tab behavior', () => {
  assert.equal(getStorefrontTab('/', ''), 'Home');
  assert.equal(getStorefrontTab('/account', ''), 'Account');
  assert.equal(getStorefrontTab('/orders', ''), 'Orders');
  assert.equal(getStorefrontPath('/account', '?verified=1'), '/account');
});

test('about, contact and support pages resolve from direct routes', () => {
  assert.equal(getStorefrontTab('/about', ''), 'About');
  assert.equal(getStorefrontTab('/contact', ''), 'Contact');
  assert.equal(getStorefrontTab('/support', ''), 'Support');
});

test('POS customer display opens from the root query route and legacy deep links', () => {
  const sessionId = 'a'.repeat(64);
  assert.equal(getPosCustomerDisplaySessionId('/', `?pos-display=${sessionId}`), sessionId);
  assert.equal(getPosCustomerDisplaySessionId(`/pos-display/${sessionId}`), sessionId);
  assert.equal(getPosCustomerDisplaySessionId('/account', ''), null);
});

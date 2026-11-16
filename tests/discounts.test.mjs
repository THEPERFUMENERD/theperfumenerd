import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStorefrontDiscounts } from '../src/discounts.ts';

const products = [
  { id: 'fractional', name: 'Fractional', price: 341.56 },
  { id: 'second', name: 'Second', price: 200 },
];

test('all-products discounts round final prices to the nearest cedi', () => {
  const discounted = applyStorefrontDiscounts(products, {
    discountMode: 'all',
    discountPercentage: 15,
  }, false);

  assert.equal(discounted[0].price, 290);
  assert.equal(discounted[0].originalPrice, 341.56);
  assert.equal(discounted[0].isOnSale, true);
  assert.equal(discounted[1].price, 170);
});

test('selected-product mode discounts only configured products', () => {
  const discounted = applyStorefrontDiscounts(products, {
    discountMode: 'selected',
    discountProducts: [{ productId: 'second', salePrice: 124.5 }],
  }, false);

  assert.equal(discounted[0], products[0]);
  assert.equal(discounted[1].price, 125);
  assert.equal(discounted[1].originalPrice, 200);
});

test('discounts are not applied before server settings load or for invalid percentages', () => {
  assert.equal(applyStorefrontDiscounts(products, {
    discountMode: 'all',
    discountPercentage: 15,
  }, true), products);
  assert.equal(applyStorefrontDiscounts(products, {
    discountMode: 'all',
    discountPercentage: 100,
  }, false), products);
});

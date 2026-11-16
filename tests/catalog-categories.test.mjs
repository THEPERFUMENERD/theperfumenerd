import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getFragranceCategories } from '../src/catalog.ts';

test('legacy fragrances retain their single category', () => {
  assert.deepEqual(getFragranceCategories({ category: 'Men' }), ['Men']);
});

test('multi-category fragrances appear in each selected category without duplicates', () => {
  const categories = getFragranceCategories({
    category: 'Men',
    categories: ['Men', 'Unisex', 'Men'],
  });

  assert.deepEqual(categories, ['Men', 'Unisex']);
  assert.equal(categories.includes('Men'), true);
  assert.equal(categories.includes('Unisex'), true);
  assert.equal(categories.includes('Women'), false);
});

test('an empty category list falls back to the legacy primary category', () => {
  assert.deepEqual(getFragranceCategories({ category: 'Women', categories: [] }), ['Women']);
});

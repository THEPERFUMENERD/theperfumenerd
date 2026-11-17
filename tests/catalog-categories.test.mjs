import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getFragranceCategories, getFragranceFamilies, optimizedCloudinaryImage, optimizedProductImage } from '../src/catalog.ts';

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

test('legacy single fragrance families and selected multiple families normalize consistently', () => {
  assert.deepEqual(getFragranceFamilies({ family: 'Woody' }), ['Woody']);
  assert.deepEqual(getFragranceFamilies({ family: 'Sweet, Fresh', families: ['Sweet', 'Fresh', 'Sweet'] }), ['Sweet', 'Fresh']);
  assert.deepEqual(getFragranceFamilies({ family: 'Amber' }), []);
});

test('Cloudinary product images request responsive automatic format and compression', () => {
  assert.equal(
    optimizedProductImage('https://res.cloudinary.com/demo/image/upload/v123/product.jpg'),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_720/v123/product.jpg',
  );
  assert.equal(
    optimizedProductImage('https://res.cloudinary.com/demo/image/upload/c_fill,w_500/v123/product.jpg'),
    'https://res.cloudinary.com/demo/image/upload/c_fill,w_500/v123/product.jpg',
  );
  assert.equal(optimizedProductImage('https://images.example.test/product.jpg'), 'https://images.example.test/product.jpg');
  assert.equal(
    optimizedCloudinaryImage('https://res.cloudinary.com/demo/image/upload/v123/hero.jpg'),
    'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1600/v123/hero.jpg',
  );
});

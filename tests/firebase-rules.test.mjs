import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-perfume-nerd';
let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
});

after(async () => {
  await environment.cleanup();
});

test('public customers can query visible products but cannot access hidden products or write products', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'products', 'visible'), { name: 'Visible', visible: true });
    await setDoc(doc(context.firestore(), 'products', 'hidden'), { name: 'Hidden', visible: false });
  });
  const publicDb = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(query(collection(publicDb, 'products'), where('visible', '==', true))));
  await assertFails(getDoc(doc(publicDb, 'products', 'hidden')));
  await assertFails(setDoc(doc(publicDb, 'products', 'attack'), { name: 'Untrusted', visible: true }));
});

test('only trusted admins and the verified allowlisted account can manage storefront products', async () => {
  const adminDb = environment.authenticatedContext('administrator', { admin: true }).firestore();
  const allowlistedDb = environment.authenticatedContext('allowlisted-admin', {
    email: 'perfumenerd6@gmail.com',
    email_verified: true,
  }).firestore();
  const unverifiedAllowlistedDb = environment.authenticatedContext('unverified-admin', {
    email: 'perfumenerd6@gmail.com',
    email_verified: false,
  }).firestore();
  const otherEmailDb = environment.authenticatedContext('other-user', {
    email: 'customer@example.com',
    email_verified: true,
  }).firestore();
  const customerDb = environment.authenticatedContext('customer', { admin: false }).firestore();
  await assertSucceeds(setDoc(doc(adminDb, 'products', 'fragrance'), {
    name: 'Fragrance', visible: true, price: 1200, stock: 5,
  }));
  await assertSucceeds(setDoc(doc(allowlistedDb, 'products', 'allowlisted-fragrance'), {
    name: 'Allowlisted fragrance', visible: true, price: 1200, stock: 5,
  }));
  await assertFails(setDoc(doc(unverifiedAllowlistedDb, 'products', 'unverified-fragrance'), {
    name: 'Unverified fragrance', visible: true, price: 1200, stock: 5,
  }));
  await assertFails(setDoc(doc(otherEmailDb, 'products', 'customer-fragrance'), {
    name: 'Customer fragrance', visible: true, price: 1200, stock: 5,
  }));
  await assertFails(setDoc(doc(customerDb, 'products', 'another'), { name: 'No', visible: true }));
  await assertSucceeds(setDoc(doc(adminDb, 'storeSettings', 'public'), { heroTitle: 'A new story' }));
  await assertFails(setDoc(doc(customerDb, 'storeSettings', 'public'), { heroTitle: 'Tampered' }));
});

test('customers can manage only their own bounded account profile', async () => {
  const customerDb = environment.authenticatedContext('customer').firestore();
  const otherDb = environment.authenticatedContext('another-customer').firestore();
  const customerProfile = doc(customerDb, 'users', 'customer');
  await assertSucceeds(setDoc(customerProfile, {
    name: 'Scent Lover',
    phoneNumber: '+233 20 000 0000',
    address: '12 Sample Street',
    city: 'Accra',
    region: 'Greater Accra',
    postalCode: 'GA-123-4567',
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(customerProfile));
  await assertFails(getDoc(doc(otherDb, 'users', 'customer')));
  await assertFails(setDoc(doc(otherDb, 'users', 'customer'), {
    name: 'Changed by another user',
    phoneNumber: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(customerDb, 'users', 'another-customer'), {
    name: 'Changed by customer',
    phoneNumber: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(customerDb, 'users', 'customer'), {
    name: 'x'.repeat(101),
    phoneNumber: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    updatedAt: serverTimestamp(),
  }));
});

test('POS records are backend-only and customer display links reveal only their active cart', async () => {
  const adminDb = environment.authenticatedContext('administrator', { admin: true }).firestore();
  const customerDb = environment.authenticatedContext('customer').firestore();
  const guestDb = environment.unauthenticatedContext().firestore();
  const displayToken = 'a'.repeat(64);
  const displayRef = doc(adminDb, 'posCustomerDisplays', displayToken);
  await assertFails(setDoc(doc(adminDb, 'sales', 'sale-1'), { totalMinor: 1200 }));
  await assertFails(setDoc(doc(customerDb, 'sales', 'customer-sale'), { totalMinor: 1 }));
  await assertFails(setDoc(doc(adminDb, 'inventoryMovements', 'direct-adjustment'), { quantityDelta: -1 }));
  await assertSucceeds(setDoc(displayRef, {
    displayToken,
    active: true,
    items: [{ productId: 'fragrance', name: 'Fragrance', quantity: 1, unitPriceMinor: 1200, lineTotalMinor: 1200 }],
    totalMinor: 1200,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(guestDb, 'posCustomerDisplays', displayToken)));
  await assertSucceeds(getDoc(doc(customerDb, 'posCustomerDisplays', displayToken)));
  await assertFails(getDocs(collection(guestDb, 'posCustomerDisplays')));
  await assertFails(setDoc(doc(guestDb, 'posCustomerDisplays', displayToken), { active: false }));
  await assertFails(setDoc(doc(adminDb, 'posCustomerDisplays', 'short-token'), {
    displayToken: 'short-token',
    active: true,
    items: [],
    totalMinor: 0,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(displayRef, { active: false, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(guestDb, 'posCustomerDisplays', displayToken)));
});

test('customers may send bounded feedback but only admins can read or moderate it', async () => {
  const guestDb = environment.unauthenticatedContext().firestore();
  const feedback = doc(collection(guestDb, 'feedback'));
  await assertSucceeds(setDoc(feedback, {
    message: 'Please add more woody fragrances.',
    name: '',
    email: '',
    userId: null,
    status: 'new',
    createdAt: serverTimestamp(),
  }));
  await assertFails(getDoc(feedback));
  await assertFails(setDoc(doc(collection(guestDb, 'feedback')), {
    message: 'x'.repeat(2001),
    name: '',
    email: '',
    userId: null,
    status: 'new',
    createdAt: serverTimestamp(),
  }));
  const adminDb = environment.authenticatedContext('administrator', { admin: true }).firestore();
  await assertSucceeds(getDoc(doc(adminDb, 'feedback', feedback.id)));
  await assertSucceeds(updateDoc(doc(adminDb, 'feedback', feedback.id), {
    status: 'resolved',
    updatedAt: serverTimestamp(),
  }));
  const guestStorage = environment.unauthenticatedContext().storage();
  await assertFails(uploadBytes(ref(guestStorage, 'product-images/guest/image.png'), new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
});

test('administrator uploads require trusted admin access and are image/size constrained', async () => {
  const adminStorage = environment.authenticatedContext('administrator', { admin: true }).storage();
  const adminImage = ref(adminStorage, 'product-images/administrator/image.png');
  await assertSucceeds(uploadBytes(adminImage, new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
  const allowlistedStorage = environment.authenticatedContext('allowlisted-admin', {
    email: 'perfumenerd6@gmail.com',
    email_verified: true,
  }).storage();
  const allowlistedImage = ref(allowlistedStorage, 'product-images/allowlisted-admin/image.png');
  await assertSucceeds(uploadBytes(allowlistedImage, new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
  const unverifiedStorage = environment.authenticatedContext('unverified-admin', {
    email: 'perfumenerd6@gmail.com',
    email_verified: false,
  }).storage();
  await assertFails(uploadBytes(
    ref(unverifiedStorage, 'product-images/unverified-admin/image.png'),
    new Uint8Array([1, 2, 3]),
    { contentType: 'image/png' },
  ));
  const publicStorage = environment.unauthenticatedContext().storage();
  await assertSucceeds(getBytes(ref(publicStorage, 'product-images/administrator/image.png')));
  await assertFails(uploadBytes(ref(adminStorage, 'storefront/another/image.png'), new Uint8Array([1]), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(adminStorage, 'storefront/administrator/not-image.txt'), new Uint8Array([1]), { contentType: 'text/plain' }));
  await assertFails(uploadBytes(ref(adminStorage, 'storefront/administrator/large.png'), new Uint8Array(5 * 1024 * 1024 + 1), { contentType: 'image/png' }));
  await assertSucceeds(deleteObject(adminImage));
});

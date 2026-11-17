import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { normalizeSmsRecipient, selectOrderSmsPhone, sendMnotifySms } from './mnotify.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const ADMIN_EMAIL = 'perfumenerd6@gmail.com';
const getPaystackSecretKey = () => {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (typeof key !== 'string' || !key.trim()) {
    throw new HttpsError('failed-precondition', 'Paystack server configuration is incomplete.');
  }
  return key.trim();
};
const PUBLIC_STORE_URL = process.env.FUNCTIONS_EMULATOR === 'true'
  ? 'http://localhost:5173'
  : process.env.PUBLIC_STORE_URL || 'https://theperfumenerd.onrender.com';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizedEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const isValidOnlineOrderId = (value) => typeof value === 'string'
  && (/^TPN-[A-F0-9]{7}$/i.test(value) || /^TPN-\d{8}-[A-F0-9]{32}$/i.test(value));
export const generateOnlineOrderId = () => `TPN-${randomBytes(4).toString('hex').slice(0, 7).toUpperCase()}`;

export function calculateOnlineOrderItems(inputItems, productDocuments, settings = {}) {
  const selectedPrices = new Map(
    Array.isArray(settings.discountProducts)
      ? settings.discountProducts.map((entry) => [entry?.productId, entry?.salePrice])
      : [],
  );
  const percentage = settings.discountMode === 'all'
    && Number.isSafeInteger(settings.discountPercentage)
    && settings.discountPercentage >= 1 && settings.discountPercentage <= 95
    ? settings.discountPercentage : 0;
  const appliesSelected = settings.discountMode === 'selected';

  return inputItems.map((line) => {
    const snapshot = productDocuments.get(line.productId);
    if (!snapshot?.exists) throw new HttpsError('not-found', 'A selected product is no longer available.');
    const product = snapshot.data();
    if (product.visible !== true || !Number.isSafeInteger(product.stock) || product.stock < line.quantity) {
      throw new HttpsError('failed-precondition', `${product.name ?? 'A selected product'} does not have enough sellable stock.`);
    }
    if (typeof product.name !== 'string' || typeof product.brand !== 'string'
      || typeof product.price !== 'number' || !Number.isFinite(product.price)
      || product.price < 0 || product.price > 1_000_000) {
      throw new HttpsError('failed-precondition', 'A selected product has invalid catalogue data.');
    }
    const salePrice = appliesSelected ? selectedPrices.get(line.productId) : undefined;
    const unitPrice = appliesSelected && Number.isFinite(salePrice) && salePrice >= 1 && salePrice < product.price
      ? Math.round(salePrice)
      : percentage > 0
        ? Math.round(product.price * (1 - percentage / 100))
        : product.price;
    const unitPriceMinor = Math.round(unitPrice * 100);
    const originalUnitPriceMinor = Math.round(product.price * 100);
    return {
      productId: line.productId,
      name: product.name,
      brand: product.brand,
      image: typeof product.image === 'string' ? product.image : '',
      quantity: line.quantity,
      unitPriceMinor,
      originalUnitPriceMinor,
      lineTotalMinor: unitPriceMinor * line.quantity,
    };
  });
}

export function validateOnlineOrder(data) {
  if (!isRecord(data) || !isRecord(data.customer) || !Array.isArray(data.items)
    || data.items.length === 0 || data.items.length > 30) {
    throw new HttpsError('invalid-argument', 'Enter valid delivery details and at least one product.');
  }
  const customer = {
    name: typeof data.customer.name === 'string' ? data.customer.name.trim() : '',
    email: normalizedEmail(data.customer.email),
    phone: typeof data.customer.phone === 'string' ? data.customer.phone.trim() : '',
    address: typeof data.customer.address === 'string' ? data.customer.address.trim() : '',
    city: typeof data.customer.city === 'string' ? data.customer.city.trim() : '',
    region: typeof data.customer.region === 'string' ? data.customer.region.trim() : '',
    postalCode: typeof data.customer.postalCode === 'string' ? data.customer.postalCode.trim() : '',
  };
  try {
    normalizeSmsRecipient(customer.phone);
  } catch {
    throw new HttpsError('invalid-argument', 'Enter a valid mobile number, including its country code.');
  }
  if (customer.name.length < 2 || customer.name.length > 100
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || customer.email.length > 254
    || customer.phone.length < 7 || customer.phone.length > 32
    || customer.address.length < 3 || customer.address.length > 200
    || customer.city.length < 2 || customer.city.length > 100
    || customer.region.length < 2 || customer.region.length > 100
    || customer.postalCode.length > 32) {
    throw new HttpsError('invalid-argument', 'Check the customer and delivery details and try again.');
  }
  const seen = new Set();
  const items = data.items.map((item) => {
    if (!isRecord(item) || typeof item.productId !== 'string' || item.productId.length < 1
      || item.productId.length > 150 || !Number.isSafeInteger(item.quantity)
      || item.quantity < 1 || item.quantity > 99 || seen.has(item.productId)) {
      throw new HttpsError('invalid-argument', 'The order contains an invalid or repeated product.');
    }
    seen.add(item.productId);
    return { productId: item.productId, quantity: item.quantity };
  });
  return { customer, items };
}

async function paystackRequest(path, secret, body) {
  const response = await fetch(`https://api.paystack.co/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.status !== true) {
    console.error('Paystack request failed.', { path, status: response.status, message: result?.message });
    throw new HttpsError('unavailable', 'The payment service is temporarily unavailable. Please try again.');
  }
  return result.data;
}

const staleSmsClaimMs = 10 * 60 * 1000;
const fulfillmentSmsDetails = {
  processing: ['Processing', 'We are preparing it for dispatch.'],
  ready_for_dispatch: ['Ready to dispatch', 'Your order is packed and ready to be sent.'],
  dispatched: ['Dispatched', 'Your order is on its way.'],
  delivered: ['Delivered', 'We hope you enjoy your fragrance.'],
};

function isActiveSmsClaim(claim) {
  if (claim?.status !== 'sending') return false;
  const updatedAt = claim.updatedAt?.toDate?.();
  return updatedAt instanceof Date && Date.now() - updatedAt.getTime() < staleSmsClaimMs;
}

async function sendOrderSms(orderRef, notificationKey, phone, message) {
  const claimField = `smsNotifications.${notificationKey}`;
  let claimed = false;
  try {
    const claimResult = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) return { status: 'failed' };
      const current = snapshot.data().smsNotifications?.[notificationKey];
      if (current?.status === 'sent') return { status: 'already_sent' };
      if (isActiveSmsClaim(current)) return { status: 'in_progress' };
      transaction.update(orderRef, {
        [claimField]: { status: 'sending', updatedAt: FieldValue.serverTimestamp() },
      });
      return { status: 'claimed' };
    });
    if (claimResult.status !== 'claimed') return claimResult.status;
    claimed = true;
    await sendMnotifySms({ phone, message });
    await orderRef.update({
      [claimField]: { status: 'sent', updatedAt: FieldValue.serverTimestamp() },
    });
    return 'sent';
  } catch (error) {
    if (claimed) {
      try {
        await orderRef.update({
          [claimField]: { status: 'failed', updatedAt: FieldValue.serverTimestamp() },
        });
      } catch (recordError) {
        console.error('Could not record failed order SMS delivery.', recordError);
      }
    }
    console.error('Order SMS delivery failed.', error instanceof Error ? error.message : 'Unknown SMS error.');
    return 'failed';
  }
}

async function getOrderSmsPhone(userId, checkoutPhone) {
  if (typeof userId !== 'string' || !userId) return checkoutPhone;
  try {
    const profileSnapshot = await db.collection('users').doc(userId).get();
    return selectOrderSmsPhone(profileSnapshot.data()?.phoneNumber, checkoutPhone);
  } catch (error) {
    console.error('Could not load the current account phone for an order SMS.', error);
    return checkoutPhone;
  }
}

async function recordSuccessfulOnlinePayment(reference, payment) {
  const orderRef = db.collection('orders').doc(reference);
  const result = await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw new HttpsError('not-found', 'The order could not be found.');
    const order = orderSnapshot.data();
    if (payment.status !== 'success' || payment.currency !== 'GHS'
      || payment.amount !== order.totalMinor) {
      throw new HttpsError('failed-precondition', 'The confirmed payment does not match this order.');
    }
    if (order.paymentStatus === 'paid') {
      return {
        orderId: order.orderId,
        status: order.status,
        phone: order.customer?.phone,
        userId: order.userId,
        totalMinor: order.totalMinor,
        shouldNotify: order.smsNotifications?.order_received?.status !== 'sent',
      };
    }
    if (order.paymentStatus !== 'pending') {
      throw new HttpsError('failed-precondition', 'This order is no longer awaiting payment.');
    }

    const productRefs = order.items.map((item) => db.collection('products').doc(item.productId));
    const productSnapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));
    const movementRefs = order.items.map(() => db.collection('inventoryMovements').doc());
    const hasStock = productSnapshots.every((snapshot, index) => snapshot.exists
      && snapshot.data().visible === true
      && Number.isSafeInteger(snapshot.data().stock)
      && snapshot.data().stock >= order.items[index].quantity);
    const now = FieldValue.serverTimestamp();
    if (hasStock) {
      productSnapshots.forEach((snapshot, index) => {
        const product = snapshot.data();
        const quantity = order.items[index].quantity;
        transaction.update(productRefs[index], {
          stock: product.stock - quantity,
          stockUpdatedAt: now,
          stockUpdatedBy: 'online_order',
        });
        transaction.create(movementRefs[index], {
          productId: snapshot.id,
          previousQuantity: product.stock,
          quantityDelta: -quantity,
          newQuantity: product.stock - quantity,
          movementType: 'online_sale',
          referenceId: reference,
          actorUid: order.userId ?? 'paystack',
          createdAt: now,
        });
      });
    }
    transaction.update(orderRef, {
      paymentStatus: 'paid',
      status: hasStock ? 'processing' : 'paid_needs_review',
      inventoryStatus: hasStock ? 'deducted' : 'insufficient_stock',
      paystackTransactionId: String(payment.id ?? ''),
      paidAt: now,
      updatedAt: now,
    });
    return {
      orderId: order.orderId,
      status: hasStock ? 'processing' : 'paid_needs_review',
      phone: order.customer?.phone,
      userId: order.userId,
      totalMinor: order.totalMinor,
      shouldNotify: true,
    };
  });
  if (!result.shouldNotify) return { orderId: result.orderId, status: result.status, smsStatus: 'already_sent' };
  const message = result.status === 'processing'
    ? `THE PERFUME NERD: We received and confirmed your order ${result.orderId} for GH₵${(result.totalMinor / 100).toFixed(2)}. We are preparing it for dispatch.`
    : `THE PERFUME NERD: We received your order ${result.orderId} and confirmed payment. Our team is checking availability and will update you shortly.`;
  const phone = await getOrderSmsPhone(result.userId, result.phone);
  const smsStatus = await sendOrderSms(orderRef, 'order_received', phone, message);
  return { orderId: result.orderId, status: result.status, smsStatus };
}

export const initializePaystackOrder = onCall(async (request) => {
  const { customer, items: requestedItems } = validateOnlineOrder(request.data);
  let orderId = '';
  let orderRef;
  const settingsRef = db.collection('storeSettings').doc('public');
  const productRefs = requestedItems.map((item) => db.collection('products').doc(item.productId));
  let order;

  await db.runTransaction(async (transaction) => {
    const settingsSnapshot = await transaction.get(settingsRef);
    const productSnapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidateId = generateOnlineOrderId();
      const candidateRef = db.collection('orders').doc(candidateId);
      if (!(await transaction.get(candidateRef)).exists) {
        orderId = candidateId;
        orderRef = candidateRef;
        break;
      }
    }
    if (!orderRef) {
      throw new HttpsError('resource-exhausted', 'Could not reserve a unique order ID. Please try again.');
    }
    const productDocuments = new Map(requestedItems.map((item, index) => [item.productId, productSnapshots[index]]));
    const pricedItems = calculateOnlineOrderItems(
      requestedItems,
      productDocuments,
      settingsSnapshot.exists ? settingsSnapshot.data() : {},
    );
    const subtotalMinor = pricedItems.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const originalSubtotalMinor = pricedItems.reduce((sum, item) => sum + item.originalUnitPriceMinor * item.quantity, 0);
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 1 || subtotalMinor > 1_000_000_000) {
      throw new HttpsError('failed-precondition', 'The order total is outside the supported payment range.');
    }
    order = {
      orderId,
      userId: request.auth?.uid ?? null,
      customer,
      items: pricedItems,
      currency: 'GHS',
      subtotalMinor,
      discountMinor: Math.max(0, originalSubtotalMinor - subtotalMinor),
      totalMinor: subtotalMinor,
      paymentStatus: 'pending',
      status: 'awaiting_payment',
      inventoryStatus: 'not_deducted',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(orderRef, order);
  });

  try {
    const payment = await paystackRequest('transaction/initialize', getPaystackSecretKey(), {
      email: customer.email,
      amount: order.totalMinor,
      currency: 'GHS',
      reference: orderId,
      callback_url: PUBLIC_STORE_URL.replace(/\/+$/, ''),
      metadata: {
        order_id: orderId,
        customer_name: customer.name,
        customer_phone: customer.phone,
      },
    });
    if (typeof payment.authorization_url !== 'string' || typeof payment.reference !== 'string'
      || payment.reference !== orderId) {
      throw new HttpsError('unavailable', 'The payment service returned an invalid checkout session.');
    }
    await orderRef.update({ updatedAt: FieldValue.serverTimestamp() });
    return { authorizationUrl: payment.authorization_url, orderId, amountMinor: order.totalMinor };
  } catch (error) {
    await orderRef.update({
      paymentStatus: 'initialization_failed',
      status: 'payment_initialization_failed',
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (error instanceof HttpsError) throw error;
    console.error('Paystack checkout initialization failed.', error);
    throw new HttpsError('unavailable', 'Could not start payment. Please try again.');
  }
});

export const verifyPaystackOrder = onCall(async (request) => {
  const reference = typeof request.data?.reference === 'string' ? request.data.reference.trim() : '';
  if (!isValidOnlineOrderId(reference)) {
    throw new HttpsError('invalid-argument', 'Enter a valid order reference.');
  }
  const orderSnapshot = await db.collection('orders').doc(reference).get();
  if (!orderSnapshot.exists) throw new HttpsError('not-found', 'The order could not be found.');
  const order = orderSnapshot.data();
  if (order.userId) {
    if (request.auth?.uid !== order.userId) {
      throw new HttpsError('permission-denied', 'Sign in to the account used for this order.');
    }
  } else if (normalizedEmail(request.data?.email) !== order.customer.email) {
    throw new HttpsError('permission-denied', 'The order email does not match.');
  }

  const payment = await paystackRequest(
    `transaction/verify/${encodeURIComponent(reference)}`,
    getPaystackSecretKey(),
  );
  if (payment.reference !== reference) {
    throw new HttpsError('failed-precondition', 'The verified payment reference does not match this order.');
  }
  if (payment.status !== 'success') {
    return { orderId: reference, paymentStatus: 'pending', status: 'awaiting_payment' };
  }
  const result = await recordSuccessfulOnlinePayment(reference, payment);
  return { ...result, paymentStatus: 'paid' };
});

export const lookupGuestOrder = onCall(async (request) => {
  const orderId = typeof request.data?.orderId === 'string' ? request.data.orderId.trim().toUpperCase() : '';
  const email = normalizedEmail(request.data?.email);
  if (!isValidOnlineOrderId(orderId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid order ID and checkout email.');
  }
  let snapshot = await db.collection('orders').doc(orderId).get();
  if (!snapshot.exists && /^TPN-[A-F0-9]{7}$/i.test(orderId)) {
    const matches = await db.collection('orders')
      .where('customer.email', '==', email)
      .limit(500)
      .get();
    snapshot = matches.docs.find((entry) => {
      const legacyReference = /^TPN-\d{8}-([A-F0-9]{32})$/i.exec(entry.id);
      return legacyReference && `TPN-${legacyReference[1].slice(0, 7)}` === orderId;
    }) ?? snapshot;
  }
  if (!snapshot.exists || snapshot.data().userId !== null || snapshot.data().customer?.email !== email) {
    throw new HttpsError('not-found', 'No guest order matched that order ID and email.');
  }
  const order = snapshot.data();
  return {
    orderId: order.orderId,
    customer: order.customer,
    items: order.items,
    currency: order.currency,
    totalMinor: order.totalMinor,
    paymentStatus: order.paymentStatus,
    status: order.status,
    createdAt: order.createdAt?.toDate?.().toISOString() ?? null,
    paidAt: order.paidAt?.toDate?.().toISOString() ?? null,
  };
});

export async function processPaystackWebhook(rawBody, signature, event) {
  const expected = createHmac('sha512', getPaystackSecretKey()).update(rawBody).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (event?.event !== 'charge.success') {
    return { statusCode: 200, body: 'Ignored' };
  }
  const payment = event.data;
  if (typeof payment?.reference !== 'string') {
    return { statusCode: 400, body: 'Invalid event' };
  }
  try {
    await recordSuccessfulOnlinePayment(payment.reference, payment);
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Paystack success webhook could not be processed.', error);
    return { statusCode: error instanceof HttpsError && error.code === 'not-found' ? 404 : 500, body: 'Webhook processing failed' };
  }
}

export const paystackWebhook = onRequest(async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed');
    return;
  }
  const result = await processPaystackWebhook(
    request.rawBody,
    request.get('x-paystack-signature') ?? '',
    request.body,
  );
  response.status(result.statusCode).send(result.body);
});

export const sendWelcomeSms = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to send the welcome message.');
  const profileRef = db.collection('users').doc(request.auth.uid);
  const notificationRef = db.collection('smsNotifications').doc(`welcome_${request.auth.uid}`);
  let phone = '';
  let claimed = false;
  try {
    const claimResult = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(profileRef);
      const notificationSnapshot = await transaction.get(notificationRef);
      if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Save your account phone number before requesting a welcome message.');
      const profile = snapshot.data();
      const existing = notificationSnapshot.exists ? notificationSnapshot.data() : {};
      if (existing?.status === 'sent') return { status: 'already_sent' };
      if (isActiveSmsClaim(existing)) return { status: 'in_progress' };
      if (typeof profile.phoneNumber !== 'string' || !profile.phoneNumber.trim()) {
        throw new HttpsError('failed-precondition', 'Add a phone number to your account before requesting a welcome message.');
      }
      phone = profile.phoneNumber.trim();
      transaction.set(notificationRef, {
        userId: request.auth.uid,
        status: 'sending',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { status: 'claimed' };
    });
    if (claimResult.status !== 'claimed') {
      return { sent: claimResult.status === 'already_sent', status: claimResult.status };
    }
    claimed = true;
    await sendMnotifySms({
      phone,
      message: 'Welcome to THE PERFUME NERD. Your account is ready. We look forward to helping you find your next signature scent.',
    });
    await notificationRef.update({
      status: 'sent',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { sent: true, status: 'sent' };
  } catch (error) {
    if (claimed) {
      try {
        await notificationRef.update({
          status: 'failed',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (recordError) {
        console.error('Could not record failed welcome SMS delivery.', recordError);
      }
    }
    if (error instanceof HttpsError) throw error;
    console.error('Welcome SMS delivery failed.', error instanceof Error ? error.message : 'Unknown SMS error.');
    return { sent: false, status: 'failed' };
  }
});

export const updateOnlineOrderStatus = onCall(async (request) => {
  if (!isAdministrator(request.auth)) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  const { orderId, status } = request.data ?? {};
  const allowedStatuses = ['processing', 'ready_for_dispatch', 'dispatched', 'delivered'];
  if (!isValidOnlineOrderId(orderId)
    || !allowedStatuses.includes(status)) {
    throw new HttpsError('invalid-argument', 'Choose a valid order and fulfillment status.');
  }
  const orderRef = db.collection('orders').doc(orderId);
  const update = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'The order could not be found.');
    const order = snapshot.data();
    if (order.paymentStatus !== 'paid') {
      throw new HttpsError('failed-precondition', 'Only paid orders can be updated.');
    }
    if (order.status === status) {
      return {
        changed: false,
        shouldNotify: order.smsNotifications?.[`fulfillment_${status}`]?.status !== 'sent',
        phone: order.customer?.phone,
        userId: order.userId,
        orderId: order.orderId,
      };
    }
    transaction.update(orderRef, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      fulfillmentUpdatedBy: request.auth.uid,
    });
    return { changed: true, shouldNotify: true, phone: order.customer?.phone, userId: order.userId, orderId: order.orderId };
  });
  if (!update.shouldNotify) return { orderId, status, smsStatus: 'already_sent' };
  const [statusLabel, detail] = fulfillmentSmsDetails[status];
  const phone = await getOrderSmsPhone(update.userId, update.phone);
  const smsStatus = await sendOrderSms(
    orderRef,
    `fulfillment_${status}`,
    phone,
    `THE PERFUME NERD: Order ${update.orderId} update: ${statusLabel}. ${detail}`,
  );
  return { orderId, status, smsStatus };
});

export const listAdminUsers = onCall(async (request) => {
  if (!isAdministrator(request.auth)) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  const pageToken = typeof request.data?.pageToken === 'string' ? request.data.pageToken : undefined;
  const adminAuth = getAdminAuth();
  const result = await adminAuth.listUsers(100, pageToken);
  const profileRefs = result.users.map((account) => db.collection('users').doc(account.uid));
  const profiles = profileRefs.length ? await db.getAll(...profileRefs) : [];
  let totalUsers = 0;
  let countToken;
  do {
    const page = await adminAuth.listUsers(1000, countToken);
    totalUsers += page.users.length;
    countToken = page.pageToken;
  } while (countToken);
  return {
    users: result.users.map((account, index) => {
      const profile = profiles[index]?.exists ? profiles[index].data() : {};
      return {
        uid: account.uid,
        name: typeof profile.name === 'string' && profile.name.trim()
          ? profile.name : account.displayName ?? '',
        email: account.email ?? '',
        phoneNumber: typeof profile.phoneNumber === 'string' && profile.phoneNumber
          ? profile.phoneNumber : account.phoneNumber ?? '',
        createdAt: account.metadata.creationTime ?? '',
      };
    }),
    nextPageToken: result.pageToken ?? null,
    totalUsers,
  };
});

function isAdministrator(auth) {
  if (!auth) return false;
  return auth.token.admin === true
    || (auth.token.email === ADMIN_EMAIL && auth.token.email_verified === true);
}

function validateSaleRequest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'Sale details are required.');
  }
  const { idempotencyKey, items, amountReceivedMinor, customer } = data;
  if (typeof idempotencyKey !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new HttpsError('invalid-argument', 'A valid sale reference is required.');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    throw new HttpsError('invalid-argument', 'A sale must contain between 1 and 30 products.');
  }
  const productIds = new Set();
  for (const item of items) {
    if (!item || typeof item.productId !== 'string' || item.productId.length < 1
      || item.productId.length > 150 || !Number.isSafeInteger(item.quantity)
      || item.quantity < 1 || item.quantity > 99 || productIds.has(item.productId)) {
      throw new HttpsError('invalid-argument', 'The sale contains an invalid or repeated product line.');
    }
    productIds.add(item.productId);
  }
  if (!Number.isSafeInteger(amountReceivedMinor) || amountReceivedMinor < 0
    || amountReceivedMinor > 100_000_000_000) {
    throw new HttpsError('invalid-argument', 'Enter a valid cash amount received.');
  }
  const cleanCustomer = customer ?? {};
  if (!cleanCustomer || typeof cleanCustomer !== 'object' || Array.isArray(cleanCustomer)
    || typeof cleanCustomer.name !== 'string' || cleanCustomer.name.length > 100
    || typeof cleanCustomer.phone !== 'string' || cleanCustomer.phone.length > 32) {
    throw new HttpsError('invalid-argument', 'Customer details are invalid.');
  }
  return { idempotencyKey, items, amountReceivedMinor, customer: cleanCustomer };
}

export const completePosCashSale = onCall(async (request) => {
  if (!isAdministrator(request.auth)) {
    throw new HttpsError('permission-denied', 'Administrator access is required to complete POS sales.');
  }

  const input = validateSaleRequest(request.data);
  const requestHash = createHash('sha256')
    .update(JSON.stringify({
      items: input.items,
      amountReceivedMinor: input.amountReceivedMinor,
      customer: {
        name: input.customer.name.trim(),
        phone: input.customer.phone.trim(),
      },
    }))
    .digest('hex');
  const saleRef = db.collection('sales').doc(input.idempotencyKey);
  const movementRefs = input.items.map(() => db.collection('inventoryMovements').doc());

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(saleRef);
    if (existing.exists) {
      const previousSale = existing.data();
      if (previousSale.cashierUid !== request.auth.uid || previousSale.channel !== 'pos') {
        throw new HttpsError('already-exists', 'This sale reference has already been used.');
      }
      if (previousSale.requestHash !== requestHash) {
        throw new HttpsError('already-exists', 'This sale reference was already used for different sale details.');
      }
      return {
        saleId: saleRef.id,
        receiptNumber: previousSale.receiptNumber,
        totalMinor: previousSale.totalMinor,
        amountReceivedMinor: previousSale.amountReceivedMinor,
        changeMinor: previousSale.changeMinor,
        items: previousSale.items,
        createdAt: previousSale.createdAt?.toDate?.().toISOString() ?? null,
      };
    }

    const productRefs = input.items.map((item) => db.collection('products').doc(item.productId));
    const productSnapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));
    const saleItems = productSnapshots.map((snapshot, index) => {
      if (!snapshot.exists) {
        throw new HttpsError('not-found', 'A selected product is no longer available.');
      }
      const product = snapshot.data();
      const line = input.items[index];
      if (product.visible !== true || !Number.isSafeInteger(product.stock) || product.stock < line.quantity) {
        throw new HttpsError('failed-precondition', `${product.name ?? 'A selected product'} does not have enough sellable stock.`);
      }
      if (typeof product.name !== 'string' || typeof product.brand !== 'string'
        || typeof product.price !== 'number' || !Number.isFinite(product.price)
        || product.price < 0 || product.price > 1_000_000) {
        throw new HttpsError('failed-precondition', 'A selected product has invalid catalogue data.');
      }
      const unitPriceMinor = Math.round(product.price * 100);
      return {
        productId: snapshot.id,
        name: product.name,
        brand: product.brand,
        image: typeof product.image === 'string' ? product.image : '',
        quantity: line.quantity,
        unitPriceMinor,
        lineTotalMinor: unitPriceMinor * line.quantity,
        previousStock: product.stock,
        newStock: product.stock - line.quantity,
      };
    });

    const totalMinor = saleItems.reduce((total, item) => total + item.lineTotalMinor, 0);
    if (!Number.isSafeInteger(totalMinor) || input.amountReceivedMinor < totalMinor) {
      throw new HttpsError('failed-precondition', 'Cash received is less than the amount due.');
    }

    const now = FieldValue.serverTimestamp();
    const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const receiptNumber = `TPN-${datePart}-${saleRef.id.slice(0, 8).toUpperCase()}`;
    const createdItems = saleItems.map(({ previousStock, newStock, ...item }) => item);
    transaction.create(saleRef, {
      channel: 'pos',
      status: 'completed',
      paymentStatus: 'paid',
      currency: 'GHS',
      requestHash,
      receiptNumber,
      cashierUid: request.auth.uid,
      cashierEmail: request.auth.token.email ?? '',
      customer: {
        name: input.customer.name.trim(),
        phone: input.customer.phone.trim(),
      },
      items: createdItems,
      subtotalMinor: totalMinor,
      discountMinor: 0,
      totalMinor,
      payments: [{
        method: 'cash',
        status: 'paid',
        amountMinor: totalMinor,
        amountReceivedMinor: input.amountReceivedMinor,
        changeMinor: input.amountReceivedMinor - totalMinor,
      }],
      amountReceivedMinor: input.amountReceivedMinor,
      changeMinor: input.amountReceivedMinor - totalMinor,
      createdAt: now,
    });

    saleItems.forEach((item, index) => {
      transaction.update(productRefs[index], {
        stock: item.newStock,
        stockUpdatedAt: now,
        stockUpdatedBy: request.auth.uid,
      });
      transaction.create(movementRefs[index], {
        productId: item.productId,
        previousQuantity: item.previousStock,
        quantityDelta: -item.quantity,
        newQuantity: item.newStock,
        movementType: 'pos_sale',
        referenceId: saleRef.id,
        actorUid: request.auth.uid,
        createdAt: now,
      });
    });

    return {
      saleId: saleRef.id,
      receiptNumber,
      totalMinor,
      amountReceivedMinor: input.amountReceivedMinor,
      changeMinor: input.amountReceivedMinor - totalMinor,
      items: createdItems,
      createdAt: new Date().toISOString(),
    };
  });
});

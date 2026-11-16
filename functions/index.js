import { createHash, randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const ADMIN_EMAIL = 'perfumenerd6@gmail.com';

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

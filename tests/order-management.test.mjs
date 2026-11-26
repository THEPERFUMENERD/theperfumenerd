import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatOrderId,
  formatOrderDay,
  filterOrdersByDateRange,
  groupOrdersByDay,
  isFulfillmentAttended,
  orderDateKey,
  searchOrders,
} from '../src/order-management.ts';

test('long legacy order IDs have a compact display alias while new IDs remain unchanged', () => {
  assert.equal(formatOrderId('TPN-20261117-08F74DE93B7B0F869E15140D91BFAADE'), 'TPN-08F74DE');
  assert.equal(formatOrderId('TPN-08F74DE'), 'TPN-08F74DE');
});

test('orders are grouped by their local calendar day in newest-day-first order', () => {
  const first = new Date('2026-11-16T09:00:00.000Z');
  const sameDay = new Date('2026-11-16T19:00:00.000Z');
  const nextDay = new Date('2026-11-17T01:00:00.000Z');
  const groups = groupOrdersByDay([
    { orderId: 'earlier', createdAt: first },
    { orderId: 'same-day-later', createdAt: sameDay },
    { orderId: 'next-day', createdAt: nextDay },
  ]);
  assert.deepEqual(groups.map((group) => group.date), ['2026-11-17', '2026-11-16']);
  assert.deepEqual(groups[1].orders.map((order) => order.orderId), ['earlier', 'same-day-later']);
  assert.equal(orderDateKey(undefined), 'unknown');
  assert.equal(orderDateKey('2026-11-17T00:30:00.000Z'), '2026-11-17');
  assert.match(formatOrderDay('2026-11-17'), /November 17, 2026/);
});

test('daily report date range includes every matching day and excludes unknown dates', () => {
  const orders = [
    { orderId: 'start', createdAt: '2026-11-01T10:00:00.000Z' },
    { orderId: 'middle', createdAt: '2026-11-03T10:00:00.000Z' },
    { orderId: 'end', createdAt: '2026-11-05T10:00:00.000Z' },
    { orderId: 'outside', createdAt: '2026-11-06T10:00:00.000Z' },
    { orderId: 'unknown' },
  ];

  assert.deepEqual(filterOrdersByDateRange(orders, '2026-11-01', '2026-11-05').map((order) => order.orderId), [
    'start', 'middle', 'end',
  ]);
  assert.deepEqual(filterOrdersByDateRange(orders, '2026-11-03').map((order) => order.orderId), ['middle']);
  assert.deepEqual(filterOrdersByDateRange(orders, '').map((order) => order.orderId), []);
});

test('orders are marked attended once ready for dispatch or further along', () => {
  assert.equal(isFulfillmentAttended('processing'), false);
  assert.equal(isFulfillmentAttended('ready_for_dispatch'), true);
  assert.equal(isFulfillmentAttended('dispatched'), true);
  assert.equal(isFulfillmentAttended('delivered'), true);
  assert.equal(isFulfillmentAttended('paid_needs_review'), false);
});

test('order search matches full or compact IDs, customer name, email and phone', () => {
  const orders = [{
    orderId: 'TPN-20261117-08F74DE93B7B0F869E15140D91BFAADE',
    customer: { name: 'Emmanuel Mawufemor Fotsi', email: 'fotsi@example.com', phone: '+233553223906' },
  }];
  assert.equal(searchOrders(orders, 'TPN-08F74DE').length, 1);
  assert.equal(searchOrders(orders, 'emmanuel mawufemor').length, 1);
  assert.equal(searchOrders(orders, 'FOTSI@EXAMPLE').length, 1);
  assert.equal(searchOrders(orders, '553223906').length, 1);
  assert.equal(searchOrders(orders, 'not found').length, 0);
});

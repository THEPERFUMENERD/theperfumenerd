import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatOrderId,
  formatOrderDay,
  groupOrdersByDay,
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

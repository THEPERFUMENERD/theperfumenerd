import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAdminOverviewMetrics, getRecentRevenue, revenueBarHeight } from '../src/admin-overview.ts';

test('overview revenue includes paid online and completed POS sales, but excludes pending payments', () => {
  const orders = [
    { totalMinor: 120000, paymentStatus: 'paid', status: 'processing', createdAt: '2026-11-17T10:00:00.000Z' },
    { totalMinor: 50000, paymentStatus: 'pending', status: 'awaiting_payment', createdAt: '2026-11-17T11:00:00.000Z' },
    { totalMinor: 90000, paymentStatus: 'paid', status: 'delivered', createdAt: '2026-11-16T22:30:00.000Z' },
  ];
  const sales = [
    { totalMinor: 75000, paymentStatus: 'paid', status: 'completed', createdAt: '2026-11-17T12:00:00.000Z' },
    { totalMinor: 40000, paymentStatus: 'pending', status: 'completed', createdAt: '2026-11-17T12:00:00.000Z' },
  ];
  const metrics = getAdminOverviewMetrics(orders, sales, '2026-11-17');
  assert.equal(metrics.revenueMinor, 285000);
  assert.equal(metrics.todayRevenueMinor, 195000);
  assert.equal(metrics.totalOrders, 4);
  assert.equal(metrics.todayOrders, 3);
  assert.equal(metrics.pendingPayment, 1);
  assert.equal(metrics.activeFulfillment, 1);
  assert.equal(metrics.posSalesToday, 1);
});

test('seven-day revenue series counts verified revenue by Accra business date', () => {
  const orders = [
    { totalMinor: 10000, paymentStatus: 'paid', createdAt: '2026-11-17T00:30:00.000Z' },
    { totalMinor: 50000, paymentStatus: 'pending', createdAt: '2026-11-17T12:00:00.000Z' },
  ];
  const sales = [
    { totalMinor: 30000, paymentStatus: 'paid', status: 'completed', createdAt: '2026-11-16T22:30:00.000Z' },
  ];
  const history = getRecentRevenue(orders, sales, '2026-11-17', 2);
  assert.deepEqual(history, [
    { date: '2026-11-16', revenueMinor: 30000 },
    { date: '2026-11-17', revenueMinor: 10000 },
  ]);
  assert.equal(revenueBarHeight(0, 0), 4);
  assert.equal(revenueBarHeight(25, 100), 25);
});

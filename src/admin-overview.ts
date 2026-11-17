import { orderDateKey, type OrderDateValue } from './order-management.ts';

export type RevenueOrder = {
  totalMinor: number;
  paymentStatus: string;
  status?: string;
  createdAt?: OrderDateValue;
};

export type RevenueSale = {
  totalMinor: number;
  paymentStatus: string;
  status?: string;
  createdAt?: OrderDateValue;
};

export function getAdminOverviewMetrics(
  orders: RevenueOrder[],
  sales: RevenueSale[],
  today: string,
) {
  const paidOrders = orders.filter((order) => order.paymentStatus === 'paid');
  const completedSales = sales.filter((sale) => sale.paymentStatus === 'paid' && sale.status === 'completed');
  const orderRevenue = (order: RevenueOrder) => Number.isSafeInteger(order.totalMinor) ? order.totalMinor : 0;
  const saleRevenue = (sale: RevenueSale) => Number.isSafeInteger(sale.totalMinor) ? sale.totalMinor : 0;
  const paidOrdersToday = paidOrders.filter((order) => orderDateKey(order.createdAt) === today);
  const completedSalesToday = completedSales.filter((sale) => orderDateKey(sale.createdAt) === today);

  return {
    revenueMinor: paidOrders.reduce((total, order) => total + orderRevenue(order), 0)
      + completedSales.reduce((total, sale) => total + saleRevenue(sale), 0),
    todayRevenueMinor: paidOrdersToday.reduce((total, order) => total + orderRevenue(order), 0)
      + completedSalesToday.reduce((total, sale) => total + saleRevenue(sale), 0),
    totalOrders: orders.length + completedSales.length,
    todayOrders: orders.filter((order) => orderDateKey(order.createdAt) === today).length + completedSalesToday.length,
    pendingPayment: orders.filter((order) => order.paymentStatus === 'pending').length,
    activeFulfillment: paidOrders.filter((order) => order.status !== 'delivered').length,
    posSalesToday: completedSalesToday.length,
  };
}

export function getRecentRevenue(
  orders: RevenueOrder[],
  sales: RevenueSale[],
  today: string,
  days = 7,
) {
  const [year, month, day] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  const dateKeys = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  });
  const byDate = new Map(dateKeys.map((date) => [date, 0]));
  orders.forEach((order) => {
    const date = orderDateKey(order.createdAt);
    if (order.paymentStatus === 'paid' && byDate.has(date) && Number.isSafeInteger(order.totalMinor)) {
      byDate.set(date, (byDate.get(date) ?? 0) + order.totalMinor);
    }
  });
  sales.forEach((sale) => {
    const date = orderDateKey(sale.createdAt);
    if (sale.paymentStatus === 'paid' && sale.status === 'completed'
      && byDate.has(date) && Number.isSafeInteger(sale.totalMinor)) {
      byDate.set(date, (byDate.get(date) ?? 0) + sale.totalMinor);
    }
  });
  return [...byDate.entries()].map(([date, revenueMinor]) => ({ date, revenueMinor }));
}

export function revenueBarHeight(revenueMinor: number, maximumMinor: number): number {
  if (revenueMinor <= 0 || maximumMinor <= 0) return 4;
  return Math.max(8, Math.round((revenueMinor / maximumMinor) * 100));
}

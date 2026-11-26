export type OrderDateValue = {
  toDate?: () => Date;
} | Date | string | null | undefined;

export type OrderSearchRecord = {
  orderId: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
};

const BUSINESS_TIME_ZONE = 'Africa/Accra';

export function formatOrderId(orderId: string): string {
  const legacyMatch = /^TPN-\d{8}-([A-F0-9]{32})$/i.exec(orderId);
  if (legacyMatch) return `TPN-${legacyMatch[1].slice(0, 7).toUpperCase()}`;
  return orderId;
}

export function orderDateValue(value: OrderDateValue): Date | null {
  const date = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : value && typeof value.toDate === 'function'
        ? value.toDate()
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function orderDateKey(value: OrderDateValue): string {
  const date = orderDateValue(value);
  if (!date) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function searchOrders<T extends OrderSearchRecord>(orders: T[], search: string): T[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return orders;
  return orders.filter((order) => [
    order.orderId,
    formatOrderId(order.orderId),
    order.customer?.name,
    order.customer?.email,
    order.customer?.phone,
  ].some((value) => value?.toLocaleLowerCase().includes(term)));
}

export function groupOrdersByDay<T extends { createdAt?: OrderDateValue }>(orders: T[]) {
  const groups = new Map<string, T[]>();
  orders.forEach((order) => {
    const key = orderDateKey(order.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), order]);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left === 'unknown'
      ? 1
      : right === 'unknown'
        ? -1
        : right.localeCompare(left))
    .map(([date, dayOrders]) => ({ date, orders: dayOrders }));
}

export function filterOrdersByDateRange<T extends { createdAt?: OrderDateValue }>(
  orders: T[],
  startDate: string,
  endDate = startDate,
): T[] {
  if (!startDate) return [];
  return orders.filter((order) => {
    const date = orderDateKey(order.createdAt);
    return date !== 'unknown' && date >= startDate && date <= endDate;
  });
}

export function isFulfillmentAttended(status: string): boolean {
  return ['ready_for_dispatch', 'dispatched', 'delivered'].includes(status);
}

export function localDateInputValue(date: Date): string {
  return orderDateKey(date);
}

export function formatOrderDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatOrderDateTime(value: OrderDateValue): string {
  const date = orderDateValue(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
      timeZone: BUSINESS_TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date)
    : 'Date unavailable';
}

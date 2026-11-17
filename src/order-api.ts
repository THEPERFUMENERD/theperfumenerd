import { auth } from './firebase';

const orderApiUrl = (import.meta.env.VITE_ORDER_API_URL || 'https://the-perfume-nerd-api.onrender.com')
  .replace(/\/+$/, '');

export async function orderApi<T>(path: string, data: unknown): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  const response = await fetch(`${orderApiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => null) as { message?: unknown } | null;
  if (!response.ok) {
    const message = typeof result?.message === 'string'
      ? result.message
      : 'The secure order service is unavailable. Please try again.';
    throw new Error(message);
  }
  if (result === null) throw new Error('The secure order service returned an invalid response.');
  return result as T;
}

const MNOTIFY_SMS_URL = 'https://api.mnotify.com/api/sms/quick';

export function normalizeSmsRecipient(value) {
  if (typeof value !== 'string') throw new Error('A valid mobile number is required.');
  const compact = value.trim().replace(/[\s()+.-]/g, '');
  if (/^0\d{9}$/.test(compact)) return `233${compact.slice(1)}`;
  if (/^233\d{9}$/.test(compact)) return compact;
  if (/^\d{8,15}$/.test(compact)) return compact;
  throw new Error('Enter a valid mobile number, including its country code.');
}

export async function sendMnotifySms({
  phone,
  message,
  apiKey = process.env.MNOTIFY_API_KEY,
  senderId = process.env.MNOTIFY_SENDER_ID || 'PERFUMENERD',
  fetchImpl = fetch,
}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('mNotify SMS is not configured on the server.');
  }
  if (typeof senderId !== 'string' || !/^[A-Za-z0-9 ]{1,11}$/.test(senderId.trim())) {
    throw new Error('The mNotify sender ID must be 1 to 11 letters or numbers.');
  }
  if (typeof message !== 'string' || message.trim().length < 1 || message.length > 1000) {
    throw new Error('SMS message must be between 1 and 1000 characters.');
  }

  const recipient = normalizeSmsRecipient(phone);
  const response = await fetchImpl(`${MNOTIFY_SMS_URL}?key=${encodeURIComponent(apiKey.trim())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: [recipient],
      sender: senderId.trim(),
      message: message.trim(),
      is_schedule: false,
      schedule_date: '',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.status === false || result?.status === 'failure' || result?.status === 'error') {
    throw new Error(`mNotify rejected the SMS request (HTTP ${response.status}).`);
  }
  return result;
}

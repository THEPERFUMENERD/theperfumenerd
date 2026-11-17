import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { pathToFileURL } from 'node:url';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT must be set in the Render environment.');
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch (error) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON.', { cause: error });
}

const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT must include project_id, client_email, and private_key.');
}
if (serviceAccount.project_id && serviceAccount.project_id !== projectId) {
  throw new Error('FIREBASE_PROJECT_ID must match the project_id in FIREBASE_SERVICE_ACCOUNT.');
}

const adminApp = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(serviceAccount), projectId });
const adminAuth = getAuth(adminApp);
const db = getFirestore(adminApp);

const {
  initializePaystackOrder,
  verifyPaystackOrder,
  lookupGuestOrder,
  updateOnlineOrderStatus,
  listAdminUsers,
  processPaystackWebhook,
} = await import('./index.js');

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'https://theperfumenerd.onrender.com',
  'https://the-perfume-nerd.web.app',
  'https://the-perfume-nerd.firebaseapp.com',
];
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || defaultOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const statusByErrorCode = {
  'invalid-argument': 400,
  'unauthenticated': 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'failed-precondition': 409,
  'resource-exhausted': 429,
  'unavailable': 503,
};

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 1_000_000) {
        tooLarge = true;
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

async function authenticateRequest(request, required) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    if (required) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw Object.assign(new Error('Invalid authorization header.'), { status: 401 });
  try {
    const token = await adminAuth.verifyIdToken(match[1], true);
    return { uid: token.uid, token };
  } catch {
    console.warn('Firebase ID token verification failed.');
    throw Object.assign(new Error('Your sign-in has expired. Sign in again and retry.'), { status: 401 });
  }
}

async function runCallable(callable, data, auth) {
  return callable.run({ data, auth });
}

async function handlePaystackWebhook(request, rawBody) {
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: 'Invalid event' };
  }
  const result = await processPaystackWebhook(
    rawBody,
    request.headers['x-paystack-signature'] ?? '',
    event,
  );
  return { status: result.statusCode, body: result.body };
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const { pathname } = requestUrl;

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (pathname === '/api/paystack/webhook') {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' });
      response.end('Method not allowed');
      return;
    }
    const rawBody = await readRequestBody(request);
    const result = await handlePaystackWebhook(request, rawBody);
    response.writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(result.body);
    return;
  }

  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: 'origin-not-allowed', message: 'This website is not allowed to use the order service.' });
    return;
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'GET, POST, OPTIONS' });
    response.end('Method not allowed');
    return;
  }

  let rawBody;
  let data;
  try {
    rawBody = await readRequestBody(request);
    data = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }

  let callable;
  let requiresAuth = false;
  switch (pathname) {
    case '/api/orders/initialize':
      callable = initializePaystackOrder;
      break;
    case '/api/orders/verify':
      callable = verifyPaystackOrder;
      break;
    case '/api/orders/guest-lookup':
      callable = lookupGuestOrder;
      break;
    case '/api/admin/orders/status':
      callable = updateOnlineOrderStatus;
      requiresAuth = true;
      break;
    case '/api/admin/users':
      callable = listAdminUsers;
      requiresAuth = true;
      break;
    default:
      sendJson(response, 404, { error: 'not-found', message: 'API route not found.' });
      return;
  }

  const auth = await authenticateRequest(request, requiresAuth);
  const result = await runCallable(callable, data, auth);
  sendJson(response, 200, result);
}

export function createRenderServer() {
  return createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      const status = error.status ?? statusByErrorCode[error.code] ?? 500;
      if (status >= 500) console.error('Render order API request failed.', error);
      sendJson(response, status, {
        error: error.code ?? 'internal',
        message: status >= 500 ? 'The order service is temporarily unavailable.' : error.message,
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3001;
  createRenderServer().listen(port, '0.0.0.0', () => {
    console.log(`The Perfume Nerd order API listening on port ${port}.`);
  });
}

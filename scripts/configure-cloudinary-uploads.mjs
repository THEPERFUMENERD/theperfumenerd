import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const credentialsPath = resolve(root, '.env.cloudinary');
const appEnvPath = resolve(root, '.env.local');
const presets = [
  { name: 'the_perfume_nerd_products', folder: 'the-perfume-nerd/product-images' },
  { name: 'the_perfume_nerd_storefront', folder: 'the-perfume-nerd/storefront' },
];

function readEnv(path) {
  if (!existsSync(path)) return new Map();
  const entries = new Map();
  for (const [index, rawLine] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid ${path === credentialsPath ? '.env.cloudinary' : '.env.local'} entry on line ${index + 1}; expected KEY=VALUE.`);
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

function updateEnvFile(path, values) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index === -1) lines.push(`${key}=${value}`);
    else lines[index] = `${key}=${value}`;
  }
  writeFileSync(path, `${lines.filter((line, index) => index < lines.length - 1 || line !== '').join('\n')}\n`, { mode: 0o600 });
}

const credentials = readEnv(credentialsPath);
const cloudName = credentials.get('CLOUDINARY_CLOUD_NAME');
const apiKey = credentials.get('CLOUDINARY_API_KEY');
const apiSecret = credentials.get('CLOUDINARY_API_SECRET');
if (!cloudName || !apiKey || !apiSecret) {
  console.error('Complete CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env.cloudinary.');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_-]+$/.test(cloudName) || !/^\d+$/.test(apiKey)) {
  console.error('The Cloudinary cloud name or API key format is invalid.');
  process.exit(1);
}

const apiBase = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}`;
const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;

async function request(path, method, parameters) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    ...(method === 'GET' ? {} : { body: new URLSearchParams(parameters) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new Error(`Cloudinary API request failed with HTTP ${status}. Check the account credentials and permissions.`);
  }
  return response.json();
}

for (const preset of presets) {
  const parameters = {
    name: preset.name,
    unsigned: 'true',
    asset_folder: preset.folder,
    allowed_formats: 'jpg,png,webp',
    disallow_public_id: 'true',
    use_filename: 'false',
    unique_filename: 'true',
    overwrite: 'false',
  };
  let method = 'POST';
  let path = '/upload_presets';
  try {
    await request(`/upload_presets/${encodeURIComponent(preset.name)}`, 'GET');
    method = 'PUT';
    path = `/upload_presets/${encodeURIComponent(preset.name)}`;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('HTTP 404')) throw error;
  }
  await request(path, method, parameters);
  const configured = await request(`/upload_presets/${encodeURIComponent(preset.name)}`, 'GET');
  const settings = configured.settings;
  const allowedFormats = Array.isArray(settings?.allowed_formats)
    ? settings.allowed_formats.join(',')
    : settings?.allowed_formats;
  if (configured.unsigned !== true || !settings || typeof settings !== 'object'
    || allowedFormats !== 'jpg,png,webp'
    || settings.disallow_public_id !== true
    || settings.asset_folder !== preset.folder) {
    throw new Error(`Cloudinary preset ${preset.name} does not have the expected unsigned-upload restrictions.`);
  }
  console.log(`Configured restricted unsigned preset: ${preset.name}`);
}

updateEnvFile(appEnvPath, {
  VITE_CLOUDINARY_CLOUD_NAME: cloudName,
  VITE_CLOUDINARY_PRODUCT_UPLOAD_PRESET: presets[0].name,
  VITE_CLOUDINARY_STOREFRONT_UPLOAD_PRESET: presets[1].name,
});
console.log('Cloudinary upload configuration was added to the ignored .env.local file.');

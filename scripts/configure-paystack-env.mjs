import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = resolve(projectRoot, '.env.local');
const functionsEnvPath = resolve(projectRoot, 'functions', '.env.the-perfume-nerd');

let contents;
try {
  contents = await readFile(sourcePath, 'utf8');
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('Add PAYSTACK_SECRET_KEY=... to the project root .env.local file, then save it.');
    process.exit(1);
  }
  throw error;
}

const matches = contents.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*PAYSTACK_SECRET_KEY\s*=(.*)$/);
  return match ? [match[1].trim()] : [];
});
if (matches.length !== 1) {
  console.error('Add exactly one PAYSTACK_SECRET_KEY=... entry to the project root .env.local file.');
  process.exit(1);
}

let secret = matches[0];
if (secret.length >= 2 && ((secret.startsWith('"') && secret.endsWith('"'))
  || (secret.startsWith("'") && secret.endsWith("'")))) {
  secret = secret.slice(1, -1).trim();
}
if (!secret || /\s/.test(secret) || (!secret.startsWith('sk_test_') && !secret.startsWith('sk_live_'))) {
  console.error('PAYSTACK_SECRET_KEY is empty or is not a valid Paystack secret-key format.');
  process.exit(1);
}

await writeFile(functionsEnvPath, `PAYSTACK_SECRET_KEY=${secret}\n`, { encoding: 'utf8', mode: 0o600 });
secret = '';
console.log('Paystack server environment configured for Firebase Functions. The generated file is git-ignored.');

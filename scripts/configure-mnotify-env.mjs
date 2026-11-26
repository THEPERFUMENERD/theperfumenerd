import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = resolve(projectRoot, '.env.local');
const functionsEnvPath = resolve(projectRoot, 'functions', '.env.the-perfume-nerd');

let sourceContents;
try {
  sourceContents = await readFile(sourcePath, 'utf8');
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('Add MNOTIFY_API_KEY=... to the ignored project root .env.local file, then save it.');
    process.exit(1);
  }
  throw error;
}

const matches = sourceContents.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*MNOTIFY_API_KEY\s*=(.*)$/);
  return match ? [match[1].trim()] : [];
});
if (matches.length !== 1) {
  console.error('Add exactly one MNOTIFY_API_KEY=... entry to the project root .env.local file.');
  process.exit(1);
}

let apiKey = matches[0];
if (apiKey.length >= 2 && ((apiKey.startsWith('"') && apiKey.endsWith('"'))
  || (apiKey.startsWith("'") && apiKey.endsWith("'")))) {
  apiKey = apiKey.slice(1, -1).trim();
}
if (!apiKey || /\s/.test(apiKey)) {
  console.error('MNOTIFY_API_KEY is empty or has an invalid format.');
  process.exit(1);
}

let targetContents = '';
try {
  targetContents = await readFile(functionsEnvPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const values = new Map();
for (const line of targetContents.split(/\r?\n/)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
  if (match && match[1] !== 'MNOTIFY_API_KEY' && match[1] !== 'MNOTIFY_SENDER_ID') {
    values.set(match[1], match[2].trim());
  }
}
values.set('MNOTIFY_API_KEY', apiKey);
values.set('MNOTIFY_SENDER_ID', 'PerfumeNerd');

await writeFile(
  functionsEnvPath,
  `${[...values].map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
  { encoding: 'utf8', mode: 0o600 },
);
apiKey = '';
sourceContents = '';
targetContents = '';
console.log('mNotify server environment configured. The generated file is git-ignored; no SMS was sent.');

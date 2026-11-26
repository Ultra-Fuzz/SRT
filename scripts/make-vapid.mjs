// Creates the key pair that identifies this app to the push services (VAPID, RFC 8292).
// Run it ONCE:   node scripts/make-vapid.mjs
//
//   public key  -> app/push-config.js        (shipped with the app, safe to publish)
//   private key -> .vapid-private-key.txt    (secret: git-ignored, never printed; paste it into
//                                             the repository secret the sender reads it from)
//
// Making new keys invalidates every existing notification subscription, so the script refuses
// to replace existing keys unless called with --force.
// (--config / --key / --gitignore override the three paths; used for testing.)

import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : resolve(ROOT, fallback);
};
const CONFIG = option('--config', 'app/push-config.js');
const KEY_FILE = option('--key', '.vapid-private-key.txt');
const GITIGNORE = option('--gitignore', '.gitignore');
const force = args.includes('--force');

const read = (path) => readFile(path, 'utf8').catch(() => null);
const shown = (path) => relative(process.cwd(), path) || path;

async function main() {
  const config = await read(CONFIG);
  const hasPublic = /VAPID_PUBLIC_KEY\s*=\s*['"][\w-]{20,}['"]/.test(config || '');
  const hasPrivate = ((await read(KEY_FILE)) || '').trim().length > 0;
  if ((hasPublic || hasPrivate) && !force) {
    console.error(`Keys already exist (${[hasPublic && shown(CONFIG), hasPrivate && shown(KEY_FILE)].filter(Boolean).join(', ')}).`);
    console.error('Replacing them would silently break notifications on every phone that has subscribed.');
    console.error('Run again with --force if that is really what you want.');
    process.exit(1);
  }

  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const publicKey = point.toString('base64url');           // 65-byte uncompressed point
  const privateKey = Buffer.from(jwk.d, 'base64url').toString('base64url'); // 32-byte scalar

  // keep the secret out of git before it exists on disk
  const ignoreEntry = relative(dirname(GITIGNORE), KEY_FILE).replace(/\\/g, '/');
  const ignore = (await read(GITIGNORE)) || '';
  if (!ignore.split(/\r?\n/).some((line) => line.trim() === ignoreEntry)) {
    await writeFile(GITIGNORE, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}# push notification signing key - never commit\n${ignoreEntry}\n`);
  }

  await writeFile(KEY_FILE, privateKey + '\n', { mode: 0o600 });
  await writeFile(CONFIG, [
    '// Public half of the push notification key pair (made by scripts/make-vapid.mjs).',
    '// Safe to publish. An empty string switches notifications off in the app.',
    `export const VAPID_PUBLIC_KEY = '${publicKey}';`,
    '',
  ].join('\n'));

  console.log(`Public key  -> ${shown(CONFIG)}`);
  console.log(`Private key -> ${shown(KEY_FILE)}  (secret, git-ignored, not shown here)`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });

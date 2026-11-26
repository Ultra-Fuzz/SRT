// Checks scripts/push.mjs:   node scripts/push.test.mjs   (exits 1 if anything is off)
//
// 1. Encryption against the worked example in RFC 8291 (section 5 + appendix A).
// 2. A random message decrypted again the way a browser would.
// 3. VAPID: the signed JWT verifies with the public key and carries the right claims.

import { createDecipheriv, createECDH, createHmac, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { b64url, encryptPayload, fromB64url, MAX_PAYLOAD_BYTES, vapidAuthorization } from './push.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`);
  if (!ok) failed++;
};

/* ---- 1. RFC 8291 test vector ------------------------------------------------------------ */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  // the complete request body from section 5
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
      + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
      + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const got = encryptPayload(RFC.plaintext, fromB64url(RFC.uaPublic), fromB64url(RFC.auth), {
  salt: fromB64url(RFC.salt), asPrivateKey: fromB64url(RFC.asPrivate),
});
// 86-byte header + 41 bytes of text + 1 delimiter + 16-byte tag. (The RFC's sample request says
// "Content-Length: 145", but the body it prints is 144 bytes - a known slip in the document.)
check('RFC 8291 example: body is 144 bytes, like the printed one', got.length === 144 && fromB64url(RFC.body).length === 144, `got ${got.length}`);
check('RFC 8291 example: body matches section 5 byte for byte', b64url(got) === RFC.body, `got      ${b64url(got)}\n     expected ${RFC.body}`);
check('RFC 8291 example: header carries the sender public key', b64url(got.subarray(21, 86)) === RFC.asPublic);

/* ---- 2. round trip with random keys ----------------------------------------------------- */
/** What the browser does on receipt (RFC 8291 section 3.4, receiver side). */
function decrypt(body, uaPrivate, uaPublic, auth) {
  const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
  const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
  const salt = body.subarray(0, 16), keyLen = body[20];
  const asPublic = body.subarray(21, 21 + keyLen), data = body.subarray(21 + keyLen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const decipher = createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)); // strip the 0x02 delimiter and any padding
}

check('RFC 8291 example: receiver decrypts it back', decrypt(got, fromB64url(RFC.uaPrivate), fromB64url(RFC.uaPublic), fromB64url(RFC.auth)).toString() === RFC.plaintext);

const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = Buffer.from('0123456789abcdef');
const message = JSON.stringify({ title: 'Pulverschnee ❄', body: '15 cm fresh at Obertauern – sunny, 1 h 10 away' });
const sealed = encryptPayload(message, ua.getPublicKey(), auth, { padding: 20 });
check('random keys: round trip (with padding, non-ASCII)', decrypt(sealed, ua.getPrivateKey(), ua.getPublicKey(), auth).toString() === message);
check('random keys: two encryptions of one message differ', !sealed.equals(encryptPayload(message, ua.getPublicKey(), auth, { padding: 20 })));
let tooBig = false;
try { encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES + 1), ua.getPublicKey(), auth); } catch { tooBig = true; }
check('oversized payload is refused', tooBig && encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES), ua.getPublicKey(), auth).length === 4096);

/* ---- 3. VAPID --------------------------------------------------------------------------- */
const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
const publicKey = b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]));
const now = Date.UTC(2026, 11, 1, 6, 0, 0);
const endpoint = 'https://web.push.apple.com/QOexample-token';
const header = vapidAuthorization(endpoint, { publicKey, privateKey: jwk.d, subject: 'mailto:owner@example.org', now });

const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
check('VAPID: header has the form "vapid t=<jwt>, k=<key>"', !!m);
if (m) {
  const [, h, c, s, k] = m;
  const pub = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } });
  const sig = fromB64url(s);
  check('VAPID: ES256 signature is 64 bytes and verifies with the public key',
    sig.length === 64 && verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, sig));
  check('VAPID: a tampered token does not verify',
    !verify('sha256', Buffer.from(`${h}.${c}x`), { key: pub, dsaEncoding: 'ieee-p1363' }, sig));
  const head = JSON.parse(fromB64url(h)), claims = JSON.parse(fromB64url(c));
  check('VAPID: JWT header is ES256', head.alg === 'ES256' && head.typ === 'JWT');
  check('VAPID: claims (aud = push service origin, exp within 24 h, sub)',
    claims.aud === 'https://web.push.apple.com' && claims.exp === now / 1000 + 12 * 3600 && claims.sub === 'mailto:owner@example.org',
    JSON.stringify(claims));
  check('VAPID: k is the public key', k === publicKey && fromB64url(k).length === 65);
  const derived = vapidAuthorization(endpoint, { privateKey: jwk.d, subject: 'mailto:owner@example.org', now });
  check('VAPID: public key can be derived from the private key', derived.endsWith(`k=${publicKey}`));
}
let badSubject = false;
try { vapidAuthorization(endpoint, { publicKey, privateKey: jwk.d, subject: 'owner@example.org' }); } catch { badSubject = true; }
check('VAPID: a subject that is not mailto:/https: is refused', badSubject);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);

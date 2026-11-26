// Sends Web Push notifications (the kind an installed home-screen web app receives on iOS 16.4+,
// Android and desktop browsers) without any dependencies.
//
//   RFC 8291  message encryption for Web Push  (ECDH P-256 + HKDF-SHA256)
//   RFC 8188  "aes128gcm" encrypted content encoding
//   RFC 8292  VAPID - identifies this sender to the push service with an ES256-signed JWT
//
// Nothing in here logs subscriptions, keys or message contents.
// Check it with:  node scripts/push.test.mjs

import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

const RECORD_SIZE = 4096;          // push services accept bodies up to 4096 bytes
const HEADER_SIZE = 16 + 4 + 1 + 65; // salt + record size + key length + sender public key
const TAG_SIZE = 16;
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_SIZE - TAG_SIZE - 1; // 1 = padding delimiter

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (text) => Buffer.from(String(text).replace(/\s+/g, ''), 'base64url');

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
/** HKDF (RFC 5869) for outputs of at most 32 bytes: one extract, one expand block. */
const hkdf = (salt, ikm, info, length) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
const text = (s) => Buffer.from(s, 'utf8');

/**
 * Encrypts one push message (RFC 8291, section 3.4). Pure: with the same inputs it always returns
 * the same bytes. `salt` and `asPrivateKey` (the one-off sender key) are random unless given, and
 * are only passed in by the tests.
 *
 * @param {Buffer|string} plaintext    message body
 * @param {Buffer} uaPublic            subscription key "p256dh" (65-byte uncompressed P-256 point)
 * @param {Buffer} authSecret          subscription key "auth" (16 bytes)
 * @returns {Buffer} request body for `Content-Encoding: aes128gcm`
 */
export function encryptPayload(plaintext, uaPublic, authSecret, { salt = randomBytes(16), asPrivateKey = null, padding = 0 } = {}) {
  const body = Buffer.isBuffer(plaintext) ? plaintext : text(plaintext);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh must be an uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('auth secret must be 16 bytes');
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');
  if (body.length + padding > MAX_PAYLOAD_BYTES) throw new Error(`push payload too large (max ${MAX_PAYLOAD_BYTES} bytes)`);

  const ecdh = createECDH('prime256v1');
  if (asPrivateKey) ecdh.setPrivateKey(asPrivateKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // combine the shared secret with the subscription's authentication secret
  const keyInfo = Buffer.concat([text('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // content-encryption key and nonce for the single record
  const cek = hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([body, Buffer.from([2]), Buffer.alloc(padding)]); // 0x02 = last record
  return Buffer.concat([header, asPublic, cipher.update(record), cipher.final(), cipher.getAuthTag()]);
}

/** Node key object for a raw VAPID key pair (base64url scalar + base64url uncompressed point). */
function vapidKey(publicKey, privateKey) {
  const d = fromB64url(privateKey);
  let point = publicKey ? fromB64url(publicKey) : null;
  if (!point) { const e = createECDH('prime256v1'); e.setPrivateKey(d); point = e.getPublicKey(); }
  if (d.length !== 32 || point.length !== 65 || point[0] !== 4) throw new Error('invalid VAPID key');
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64url(d), x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33)) } });
  return { key, point };
}

/**
 * Builds the VAPID `Authorization` header value for one push service (RFC 8292).
 * `subject` must be a plain `mailto:name@example.org` or `https://...` URL - Apple's push
 * service rejects anything else (no spaces, no angle brackets, no localhost).
 */
export function vapidAuthorization(endpoint, { publicKey, privateKey, subject, expiresIn = 12 * 3600, now = Date.now() }) {
  if (!/^(mailto:[^\s<>]+@[^\s<>]+|https:\/\/\S+)$/.test(subject || '')) throw new Error('VAPID subject must be a mailto: or https: URL');
  const { key, point } = vapidKey(publicKey, privateKey);
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + Math.min(expiresIn, 24 * 3600), sub: subject }));
  const signature = sign('sha256', text(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${b64url(point)}`;
}

/**
 * Sends one notification to one subscribed device.
 *
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription  PushSubscription.toJSON()
 * @param {object} payload  JSON-serialisable message for the service worker's "push" handler
 * @returns {Promise<{ok: boolean, status: number, gone: boolean}>}  `gone` = the subscription no
 *          longer exists (404 / 410) and should be deleted. `status` is 0 on a network error.
 */
export async function sendPush(subscription, payload, { publicKey, privateKey, subject, ttl = 43200, urgency = 'normal' } = {}) {
  const body = encryptPayload(JSON.stringify(payload), fromB64url(subscription.keys.p256dh), fromB64url(subscription.keys.auth));
  const authorization = vapidAuthorization(subscription.endpoint, { publicKey, privateKey, subject });
  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (bytes) => dec.decode(bytes);

export function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const bytesToB64url = (bytes) =>
  bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function b64urlToBytes(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('Invalid base64url');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** 128-bit random identifier, 22 base64url characters. */
export const randomId = () => bytesToB64url(randomBytes(16));

export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const isId = (s) => typeof s === 'string' && ID_RE.test(s);

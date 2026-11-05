// Client-side encryption for the personal vault (Web Crypto only).
//
// passphrase ──PBKDF2-SHA-256──▶ KEK ──unwrap──▶ Vault Master Key (AES-256-GCM, non-extractable)
// recovery code ──HKDF-SHA-256──▶ KEK' ──unwrap──▶ same Vault Master Key
// Every file: gzip → AES-256-GCM, fresh 96-bit IV, AAD = "neuron:v1:<logical path>".

import { utf8, fromUtf8, bytesToB64url, b64urlToBytes, randomBytes } from '../core/b64.js';

export const MIN_ITERATIONS = 100_000;
const AES = { name: 'AES-GCM', length: 256 };
const subtle = () => globalThis.crypto.subtle;

export class CryptoError extends Error {
  constructor(code, message) { super(message); this.name = 'CryptoError'; this.code = code; }
}

const aadFor = (label) => utf8(`neuron:v1:${label}`);

// ── Compression ──
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

// ── Key derivation ──
export function newKdfParams(iterations) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) throw new CryptoError('kdf', `PBKDF2 needs at least ${MIN_ITERATIONS} iterations`);
  return { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToB64url(randomBytes(16)) };
}

function checkKdf(kdf) {
  if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || typeof kdf.salt !== 'string') {
    throw new CryptoError('unsupported', 'Unsupported key-derivation parameters');
  }
}

export async function derivePassphraseKey(passphrase, kdf) {
  checkKdf(kdf);
  const base = await subtle().importKey('raw', utf8(String(passphrase).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64urlToBytes(kdf.salt), iterations: kdf.iterations },
    base, AES, false, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']);
}

async function deriveRecoveryKey(codeBytes, salt) {
  const base = await subtle().importKey('raw', codeBytes, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('neuron:v1:recovery') },
    base, AES, false, ['wrapKey', 'unwrapKey']);
}

// ── Recovery code (Crockford base32, 256 bits) ──
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function formatRecoveryCode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join('-');
}
export function parseRecoveryCode(text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{52}$/.test(clean)) throw new CryptoError('format', 'A recovery code has 52 characters (letters and digits)');
  const out = new Uint8Array(32);
  let bits = 0, value = 0, i = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { if (i < 32) out[i++] = (value >>> (bits - 8)) & 255; bits -= 8; }
    value &= (1 << bits) - 1;
  }
  return out;
}

// ── Key wrapping ──
async function wrap(key, kek, label) {
  const iv = randomBytes(12);
  const ct = await subtle().wrapKey('raw', key, kek, { name: 'AES-GCM', iv, additionalData: aadFor(label) });
  return { iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ct)) };
}

async function unwrap(w, kek, label, extractable) {
  try {
    return await subtle().unwrapKey('raw', b64urlToBytes(w.ct), kek,
      { name: 'AES-GCM', iv: b64urlToBytes(w.iv), additionalData: aadFor(label) },
      AES, extractable, ['encrypt', 'decrypt']);
  } catch {
    throw new CryptoError('wrong_secret', 'That passphrase or recovery code does not unlock this vault');
  }
}

/** Create a new vault keyring. Returns the keyring (safe to store), the in-memory key, and the one-time recovery code. */
export async function createKeyring(passphrase, iterations) {
  const vmk = await subtle().generateKey(AES, true, ['encrypt', 'decrypt']);
  const kdf = newKdfParams(iterations);
  const kek = await derivePassphraseKey(passphrase, kdf);
  const code = randomBytes(32);
  const recSalt = randomBytes(16);
  const recKek = await deriveRecoveryKey(code, recSalt);
  const keyring = {
    neuron: 'keyring', v: 1, createdAt: new Date().toISOString(), kdf,
    wraps: {
      passphrase: await wrap(vmk, kek, 'keyring/passphrase'),
      recovery: { salt: bytesToB64url(recSalt), ...(await wrap(vmk, recKek, 'keyring/recovery')) },
    },
  };
  const key = await unwrap(keyring.wraps.passphrase, kek, 'keyring/passphrase', false);
  return { keyring, key, recoveryCode: formatRecoveryCode(code) };
}

function checkKeyring(keyring) {
  if (!keyring || keyring.neuron !== 'keyring' || keyring.v !== 1 || !keyring.wraps?.passphrase) {
    throw new CryptoError('unsupported', 'Unrecognised vault keyring format');
  }
}

export async function unlockWithPassphrase(keyring, passphrase, { extractable = false } = {}) {
  checkKeyring(keyring);
  const kek = await derivePassphraseKey(passphrase, keyring.kdf);
  return unwrap(keyring.wraps.passphrase, kek, 'keyring/passphrase', extractable);
}

export async function unlockWithRecovery(keyring, recoveryCode, { extractable = false } = {}) {
  checkKeyring(keyring);
  const r = keyring.wraps.recovery;
  if (!r) throw new CryptoError('unsupported', 'This vault has no recovery code');
  const kek = await deriveRecoveryKey(parseRecoveryCode(recoveryCode), b64urlToBytes(r.salt));
  return unwrap(r, kek, 'keyring/recovery', extractable);
}

/** New passphrase wrap for an extractable vault key (from unlock*({extractable:true})). Keeps the recovery wrap. */
export async function rewrapWithPassphrase(keyring, extractableKey, newPassphrase, iterations) {
  checkKeyring(keyring);
  const kdf = newKdfParams(iterations);
  const kek = await derivePassphraseKey(newPassphrase, kdf);
  return { ...keyring, kdf, updatedAt: new Date().toISOString(), wraps: { ...keyring.wraps, passphrase: await wrap(extractableKey, kek, 'keyring/passphrase') } };
}

export async function toSessionKey(extractableKey) {
  const raw = new Uint8Array(await subtle().exportKey('raw', extractableKey));
  try {
    return await subtle().importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

// ── Envelopes ──
export async function seal(key, value, label) {
  const iv = randomBytes(12);
  const plain = await gzip(utf8(JSON.stringify(value)));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(label) }, key, plain);
  return JSON.stringify({ neuron: 'enc', v: 1, alg: 'A256GCM', z: 'gzip', iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ct)) });
}

export async function open(key, envelope, label) {
  let env;
  try { env = typeof envelope === 'string' ? JSON.parse(envelope) : envelope; } catch { throw new CryptoError('corrupt', 'Encrypted file is not valid JSON'); }
  if (!env || env.neuron !== 'enc') throw new CryptoError('corrupt', 'Not a Neuron encrypted file');
  if (env.v !== 1 || env.alg !== 'A256GCM' || env.z !== 'gzip') throw new CryptoError('unsupported', `Unsupported encryption format (v${env.v})`);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: b64urlToBytes(env.iv), additionalData: aadFor(label) }, key, b64urlToBytes(env.ct));
  } catch {
    throw new CryptoError('auth', 'Decryption failed: the file was modified, moved, or encrypted with a different key');
  }
  try {
    return JSON.parse(fromUtf8(await gunzip(new Uint8Array(plain))));
  } catch {
    throw new CryptoError('corrupt', 'Decrypted data is unreadable');
  }
}

// ── Device secret (the GitHub token remembered on one device) ──
export async function sealSecret(passphrase, secret, iterations) {
  const kdf = newKdfParams(iterations);
  const key = await derivePassphraseKey(passphrase, kdf);
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadFor('device/token') }, key, utf8(secret));
  return { neuron: 'device', v: 1, kdf, iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ct)) };
}

export async function openSecret(passphrase, record) {
  if (!record || record.neuron !== 'device' || record.v !== 1) throw new CryptoError('unsupported', 'Unrecognised device record');
  const key = await derivePassphraseKey(passphrase, record.kdf);
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: b64urlToBytes(record.iv), additionalData: aadFor('device/token') }, key, b64urlToBytes(record.ct));
    return fromUtf8(new Uint8Array(pt));
  } catch {
    throw new CryptoError('wrong_secret', 'That passphrase does not unlock the token saved on this device');
  }
}

/** Rough strength gate: ≥ 16 characters, or ≥ 4 words with ≥ 12 letters overall. */
export function passphraseProblem(p) {
  const s = String(p || '');
  if (s.length >= 16) return null;
  const words = s.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 2);
  if (words.length >= 4 && s.replace(/\W/g, '').length >= 12) return null;
  return 'Use at least 16 characters, or a phrase of 4 or more words. This passphrase is the only thing protecting your maps against offline guessing.';
}

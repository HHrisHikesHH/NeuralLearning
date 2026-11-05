import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeyring, unlockWithPassphrase, unlockWithRecovery, rewrapWithPassphrase, toSessionKey,
  seal, open, sealSecret, openSecret, formatRecoveryCode, parseRecoveryCode, passphraseProblem, CryptoError,
} from '../js/owner/crypto.js';
import { randomBytes } from '../js/core/b64.js';

const IT = 100_000; // minimum allowed; production uses 1,000,000
const PASS = 'correct horse battery staple';
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e instanceof CryptoError ? e.code : `other:${e.message}`; } };

test('keyring: passphrase and recovery code both unlock the same key', async () => {
  const { keyring, key, recoveryCode } = await createKeyring(PASS, IT);
  assert.equal(key.extractable, false, 'session key must not be extractable');
  const env = await seal(key, { hello: 'world' }, 'vault/manifest');
  const k2 = await unlockWithPassphrase(keyring, PASS);
  assert.deepEqual(await open(k2, env, 'vault/manifest'), { hello: 'world' });
  const k3 = await unlockWithRecovery(keyring, recoveryCode.toLowerCase().replace(/-/g, ' '));
  assert.deepEqual(await open(k3, env, 'vault/manifest'), { hello: 'world' });
  assert.equal(JSON.stringify(keyring).includes(PASS), false);
});

test('wrong passphrase / recovery code is rejected', async () => {
  const { keyring } = await createKeyring(PASS, IT);
  assert.equal(await code(unlockWithPassphrase(keyring, 'wrong horse battery staple')), 'wrong_secret');
  const other = formatRecoveryCode(randomBytes(32));
  assert.equal(await code(unlockWithRecovery(keyring, other)), 'wrong_secret');
  assert.equal(await code(unlockWithRecovery(keyring, 'too-short')), 'format');
});

test('tampering with ciphertext, IV, or path (AAD) fails authentication', async () => {
  const { key } = await createKeyring(PASS, IT);
  const envText = await seal(key, { secret: 'map' }, 'vault/maps/A');
  const env = JSON.parse(envText);
  const flip = (s) => (s[5] === 'A' ? s.slice(0, 5) + 'B' + s.slice(6) : s.slice(0, 5) + 'A' + s.slice(6));
  assert.equal(await code(open(key, { ...env, ct: flip(env.ct) }, 'vault/maps/A')), 'auth');
  assert.equal(await code(open(key, { ...env, iv: flip(env.iv) }, 'vault/maps/A')), 'auth');
  assert.equal(await code(open(key, envText, 'vault/maps/B')), 'auth', 'file moved to another path');
  assert.equal(await code(open(key, { ...env, v: 2 }, 'vault/maps/A')), 'unsupported');
  assert.equal(await code(open(key, 'not json', 'x')), 'corrupt');
  const { key: other } = await createKeyring(PASS, IT);
  assert.equal(await code(open(other, envText, 'vault/maps/A')), 'auth', 'different vault key');
});

test('every encryption uses a fresh IV and nothing readable leaks', async () => {
  const { key } = await createKeyring(PASS, IT);
  const ivs = new Set();
  for (let i = 0; i < 50; i++) ivs.add(JSON.parse(await seal(key, { topic: 'Stoicism' }, 'x')).iv);
  assert.equal(ivs.size, 50);
  const env = await seal(key, { title: 'My Secret Title', topic: 'Stoicism' }, 'x');
  assert.equal(/Secret|Stoicism/.test(env), false);
});

test('passphrase change keeps the same vault key and the recovery wrap', async () => {
  const { keyring, recoveryCode } = await createKeyring(PASS, IT);
  const sessionKey = await unlockWithPassphrase(keyring, PASS);
  const env = await seal(sessionKey, [1, 2, 3], 'p');
  const ext = await unlockWithPassphrase(keyring, PASS, { extractable: true });
  const next = await rewrapWithPassphrase(keyring, ext, 'a whole new passphrase here', IT);
  assert.equal(await code(unlockWithPassphrase(next, PASS)), 'wrong_secret');
  assert.deepEqual(await open(await unlockWithPassphrase(next, 'a whole new passphrase here'), env, 'p'), [1, 2, 3]);
  assert.deepEqual(await open(await unlockWithRecovery(next, recoveryCode), env, 'p'), [1, 2, 3]);
  const s = await toSessionKey(ext);
  assert.equal(s.extractable, false);
});

test('weak KDF parameters are refused', async () => {
  const { keyring } = await createKeyring(PASS, IT);
  assert.equal(await code(unlockWithPassphrase({ ...keyring, kdf: { ...keyring.kdf, iterations: 10 } }, PASS)), 'unsupported');
  assert.equal(await code(createKeyring(PASS, 1000)), 'kdf');
});

test('device token sealing round-trips and rejects the wrong passphrase', async () => {
  const rec = await sealSecret(PASS, 'github_pat_EXAMPLE', IT);
  assert.equal(JSON.stringify(rec).includes('github_pat'), false);
  assert.equal(await openSecret(PASS, rec), 'github_pat_EXAMPLE');
  assert.equal(await code(openSecret('nope nope nope nope', rec)), 'wrong_secret');
});

test('recovery code format is stable and forgiving', () => {
  const bytes = randomBytes(32);
  const c = formatRecoveryCode(bytes);
  assert.match(c, /^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(parseRecoveryCode(c), bytes);
  assert.deepEqual(parseRecoveryCode(c.toLowerCase().replace(/-/g, '  ')), bytes);
});

test('large maps compress and round-trip', async () => {
  const { key } = await createKeyring(PASS, IT);
  const big = { text: 'lorem ipsum '.repeat(40000) };
  const env = await seal(key, big, 'big');
  assert.ok(env.length < 20000, `envelope ${env.length} bytes`);
  assert.deepEqual(await open(key, env, 'big'), big);
});

test('passphrase strength rule', () => {
  assert.ok(passphraseProblem('short'));
  assert.ok(passphraseProblem('abc def ghi'));
  assert.equal(passphraseProblem('sixteen chars!!!'), null);
  assert.equal(passphraseProblem('river cloud ember tide'), null);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nacl = require('tweetnacl');

class Bucket {
  constructor() { this.records = new Map(); this.revision = 0; }
  async get(key) {
    const record = this.records.get(key);
    if (!record) return null;
    return { etag: record.etag, text: async () => record.value, json: async () => JSON.parse(record.value) };
  }
  async put(key, value, options) {
    if (options?.onlyIf && this.records.get(key)?.etag !== options.onlyIf.etagMatches) return null;
    const record = { value, etag: String(++this.revision), uploaded: new Date() };
    this.records.set(key, record); return record;
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.records.delete(key); }
  async list(options) { return { objects: Array.from(this.records, ([key, value]) => ({ key, uploaded: value.uploaded })).filter(item => item.key.startsWith(options.prefix)) }; }
}
async function createBackend() {
  const source = fs.readFileSync(path.join(__dirname, '../pairing-service/worker/index.js'), 'utf8');
  const phone = fs.readFileSync(path.join(__dirname, '../pairing-service/worker/phone.html'), 'utf8');
  const naclSource = fs.readFileSync(path.join(__dirname, '../app/vendor/nacl-fast.min.js'), 'utf8');
  const built = source.replace("'__PHONE_PAGE__'", () => JSON.stringify(phone)).replace("'__NACL_SOURCE__'", () => JSON.stringify(naclSource));
  const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(built).toString('base64'));
  const bucket = new Bucket();
  return { bucket, fetch: request => worker.fetch(request, { BUCKET: bucket }, { waitUntil(promise) { promise.catch(() => {}); } }) };
}
const request = (url, method = 'GET', data, token, ip = 'one') => new Request('https://pair.test' + url, {
  method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  ...(data ? { body: JSON.stringify(data) } : {})
});
const token = () => crypto.randomBytes(32).toString('hex');
const hash = value => crypto.createHash('sha512').update(value).digest('hex');

test('phone pairing stores only ciphertext and only the originating TV can retrieve or delete it', async () => {
  const backend = await createBackend(), pollToken = token();
  const made = await backend.fetch(request('/api/pair', 'POST', { pollHash: hash(pollToken) }));
  assert.equal(made.status, 201);
  const { id } = await made.json();
  const secret = nacl.randomBytes(32), nonce = nacl.randomBytes(24), key = 'gsk_' + 'test'.repeat(12);
  const box = nacl.secretbox(Buffer.from(key), nonce, secret);
  const packet = { nonce: Buffer.from(nonce).toString('base64url'), box: Buffer.from(box).toString('base64url') };
  assert.equal((await backend.fetch(request('/api/pair/' + id))).status, 401);
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'DELETE', null, token()))).status, 401);
  assert.deepEqual(await (await backend.fetch(request('/api/pair/' + id, 'GET', null, pollToken))).json(), { pending: true });
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'POST', packet))).status, 200);
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'POST', packet))).status, 409);
  const stored = await (await backend.fetch(request('/api/pair/' + id, 'GET', null, pollToken))).json();
  assert.equal(Buffer.from(nacl.secretbox.open(Buffer.from(stored.box, 'base64url'), Buffer.from(stored.nonce, 'base64url'), secret)).toString(), key);
  assert.equal(JSON.stringify(Array.from(backend.bucket.records.values())).includes(key), false);
  assert.equal(JSON.stringify(Array.from(backend.bucket.records.values())).includes(pollToken), false);
  assert.equal(nacl.secretbox.open(Buffer.from(stored.box, 'base64url'), nonce, nacl.randomBytes(32)), null);
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'DELETE', null, pollToken))).status, 200);
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'GET', null, pollToken))).status, 410);
});
test('pairing rejects plaintext keys, oversized packets and expired sessions', async () => {
  const backend = await createBackend(), pollToken = token();
  const { id } = await (await backend.fetch(request('/api/pair', 'POST', { pollHash: hash(pollToken) }))).json();
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'POST', { key: 'gsk_' + 'a'.repeat(48) }))).status, 400);
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'POST', { nonce: 'a'.repeat(32), box: 'b'.repeat(10000) }))).status, 400);
  const record = backend.bucket.records.get('pair/' + id), data = JSON.parse(record.value);
  data.expires = Date.now() - 1; record.value = JSON.stringify(data);
  assert.equal((await backend.fetch(request('/api/pair/' + id, 'GET', null, pollToken))).status, 410);
  assert.equal(backend.bucket.records.has('pair/' + id), false);
});
test('pairing creation is throttled and simultaneous phone submissions cannot overwrite a connection', async () => {
  const backend = await createBackend(), pollToken = token();
  const { id } = await (await backend.fetch(request('/api/pair', 'POST', { pollHash: hash(pollToken) }))).json();
  assert.equal((await backend.fetch(request('/api/pair', 'POST', { pollHash: hash(token()) }))).status, 429);
  const packet = { nonce: 'a'.repeat(32), box: 'b'.repeat(50) };
  const results = await Promise.all([backend.fetch(request('/api/pair/' + id, 'POST', packet)), backend.fetch(request('/api/pair/' + id, 'POST', packet))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
});
module.exports = { createBackend };

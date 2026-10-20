const PHONE_PAGE = '__PHONE_PAGE__';
const NACL_SOURCE = '__NACL_SOURCE__';
const TTL = 10 * 60 * 1000;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://api.groq.com; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('json');
  const reader = request.body?.getReader();
  let size = 0, text = '';
  const decoder = new TextDecoder();
  if (!reader) throw new Error('body');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error('size'); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
async function authorized(request, session) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(token))));
  let different = 0;
  for (let i = 0; i < 128; i++) different |= hash.charCodeAt(i) ^ session.pollHash.charCodeAt(i);
  return different === 0;
}
async function cleanup(bucket) {
  const page = await bucket.list({ prefix: 'pair/', limit: 1000 });
  const expired = page.objects.filter(object => object.uploaded.getTime() < Date.now() - TTL).map(object => object.key);
  if (expired.length) await bucket.delete(expired);
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET' && (path === '/' || path === '/connect')) return new Response(PHONE_PAGE, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    if (request.method === 'GET' && path === '/nacl.js') return new Response(NACL_SOURCE, { headers: { ...headers, 'Content-Type': 'text/javascript' } });
    if (request.method === 'GET' && path === '/health') return json({ ok: !!env.BUCKET });
    if (!path.startsWith('/api/pair')) return json({ error: 'Not found' }, 404);
    if (!env.BUCKET) return json({ error: 'Pairing is unavailable' }, 503);
    try {
      if (request.method === 'POST' && path === '/api/pair') {
        const data = await body(request);
        if (!/^[a-f0-9]{128}$/.test(data.pollHash)) return json({ error: 'Invalid session' }, 400);
        ctx.waitUntil(cleanup(env.BUCKET).catch(() => {}));
        const address = request.headers.get('CF-Connecting-IP') || 'local';
        const addressHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address))));
        const gateKey = 'rate/' + addressHash;
        const gate = await env.BUCKET.get(gateKey);
        if (gate && Date.now() - Number(await gate.text()) < 5000) return json({ error: 'Please wait a moment and try again' }, 429);
        await env.BUCKET.put(gateKey, String(Date.now()));
        const id = hex(crypto.getRandomValues(new Uint8Array(16)));
        const expires = Date.now() + TTL;
        await env.BUCKET.put('pair/' + id, JSON.stringify({ pollHash: data.pollHash, expires, packet: null }));
        return json({ id, expires }, 201);
      }
      const match = /^\/api\/pair\/([a-f0-9]{32})$/.exec(path);
      if (!match) return json({ error: 'Not found' }, 404);
      const objectKey = 'pair/' + match[1];
      const object = await env.BUCKET.get(objectKey);
      if (!object) return json({ error: 'This connection has expired' }, 410);
      const session = await object.json();
      if (Date.now() >= session.expires) { await env.BUCKET.delete(objectKey); return json({ error: 'This connection has expired' }, 410); }
      if (request.method === 'POST') {
        const data = await body(request);
        if (!/^[A-Za-z0-9_-]{32}$/.test(data.nonce) || !/^[A-Za-z0-9_-]{40,512}$/.test(data.box)) return json({ error: 'Invalid connection' }, 400);
        if (session.packet) return json({ error: 'This code has already been used' }, 409);
        session.packet = { nonce: data.nonce, box: data.box };
        const saved = await env.BUCKET.put(objectKey, JSON.stringify(session), { onlyIf: { etagMatches: object.etag } });
        return saved ? json({ ok: true }) : json({ error: 'This code has already been used' }, 409);
      }
      if (!await authorized(request, session)) return json({ error: 'Not authorized' }, 401);
      if (request.method === 'GET') return json(session.packet || { pending: true });
      if (request.method === 'DELETE') { await env.BUCKET.delete(objectKey); return json({ ok: true }); }
      return json({ error: 'Method not allowed' }, 405);
    } catch { return json({ error: 'Could not complete this connection. Please try again.' }, 400); }
  }
};

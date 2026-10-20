const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function page(state = 'RUNNING', watching = 123, id = 'Cast') {
  return `<meta name="twitter:string:broadcast_state" content="${state}">` +
    '<meta content="28_123" name="twitter:text:broadcast_media_key">' +
    `broadcast_by_rest_id:$R[15]={broadcast_id:"${id}",chat_option:2,total_watched:9999,total_watching:${watching},user_results:$R[17]={}`;
}
function msg(id, text, type = 1) {
  return { kind: 1, payload: JSON.stringify({ sender: { display_name: 'Viewer', username: 'viewer' },
    body: JSON.stringify({ type, uuid: id, timestamp: Number(id) || 1, body: text }) }) };
}
function fixture(respond) {
  let next = 0;
  const timers = new Map(), requests = [], updates = [];
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function(method, url) { this.method = method; this.url = new URL(url); };
  XMLHttpRequest.prototype.setRequestHeader = function() {};
  XMLHttpRequest.prototype.abort = function() { this.aborted = true; };
  XMLHttpRequest.prototype.send = function(body) {
    const entry = { xhr: this, method: this.method, url: this.url, body: body && JSON.parse(body) };
    requests.push(entry);
    setImmediate(() => {
      if (this.aborted) return;
      const result = respond(entry);
      if (result === 'pending') return;
      if (!result) return this.onerror();
      this.status = result.status || 200;
      this.responseText = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      this.onload();
    });
  };
  const context = { XMLHttpRequest, Date,
    setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id) };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('app/broadcast.js', 'utf8'), context);
  const watcher = context.HelloBroadcast.watch('Cast', data => updates.push(data));
  const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
  return { watcher, updates, requests, timers, flush,
    run: async ms => { const t = [...timers].find(([, v]) => v.ms === ms); assert.ok(t, 'scheduled ' + ms); timers.delete(t[0]); t[1].fn(); await flush(); } };
}
function source(entry, options = {}) {
  if (entry.url.hostname === 'x.com') return { body: options.html || page() };
  if (entry.url.hostname === 'api.x.com') return { body: { chatToken: 'public-chat-token' } };
  if (entry.url.pathname.endsWith('accessChatPublic')) return { body: {
    endpoint: 'https://chatman-live.pscp.tv', access_token: 'live-access',
    replay_endpoint: 'https://chatman-replay.pscp.tv', replay_access_token: 'replay-access' } };
  if (entry.url.pathname.endsWith('/history')) return { body: { messages: options.messages || [], cursor: '' } };
}

test('concurrent count is distinct from total views, zero is valid, and ended counts are hidden', async () => {
  let html = page();
  const f = fixture(e => source(e, { html }));
  await f.flush();
  assert.equal(f.updates.at(-1).watching, 123);
  assert.equal(f.requests.length, 1, 'chat only requested when its tab is open');
  html = page('RUNNING', 0);
  await f.run(15000);
  assert.equal(f.updates.at(-1).watching, 0);
  html = page('ENDED', 375);
  await f.run(15000);
  assert.equal(f.updates.at(-1).ended, true);
  assert.equal(f.updates.at(-1).watching, null, 'ended SSR count must not look current');
  assert.equal(f.timers.size, 0);
  f.watcher.close();
});

test('unknown or failed metadata never supplies a guessed or stale count', async () => {
  let html = page('RUNNING', 4, 'Other');
  const f = fixture(e => html === null ? null : source(e, { html }));
  await f.flush();
  assert.equal(f.updates.at(-1).watching, null);
  html = page('RUNNING', 56);
  await f.run(15000);
  assert.equal(f.updates.at(-1).watching, 56);
  html = null;
  await f.run(15000);
  assert.equal(f.updates.at(-1).watching, null);
  f.watcher.close();
});

test('public chat handles nested payloads, filters non-chat, deduplicates and stops polling on close', async () => {
  let batch = [msg('1', '<b>literal</b> 🪩'), msg('1', 'duplicate'), msg('2', 'heart', 2), { kind: 1, payload: 'broken' }];
  const f = fixture(e => source(e, { messages: batch }));
  f.watcher.setChatEnabled(true); // Also covers selecting chat before metadata arrives.
  await f.flush();
  assert.equal(f.updates.at(-1).messages.length, 1);
  assert.equal(f.updates.at(-1).messages[0].text, '<b>literal</b> 🪩');
  assert.equal(f.requests.find(e => e.url.pathname.endsWith('accessChatPublic')).method, 'GET');
  assert.equal(f.requests.find(e => e.url.pathname.endsWith('/history')).body.access_token, 'live-access');
  batch = [msg('1', 'duplicate'), msg('3', 'New live message')];
  await f.run(3000);
  assert.equal(f.updates.at(-1).messages.length, 2);
  assert.equal(f.updates.at(-1).messages[1].text, 'New live message');
  f.watcher.setChatEnabled(false);
  assert.ok(![...f.timers.values()].some(t => t.ms === 3000));
  f.watcher.close();
  assert.equal(f.timers.size, 0);
});

test('replay reads the replay endpoint and stops polling; an empty successful response stays empty', async () => {
  const f = fixture(e => source(e, { html: page('ENDED', 42) }));
  f.watcher.setChatEnabled(true);
  await f.flush();
  const history = f.requests.find(e => e.url.pathname.endsWith('/history'));
  assert.equal(history.url.hostname, 'chatman-replay.pscp.tv');
  assert.equal(history.body.access_token, 'replay-access');
  assert.equal(history.body.since, null);
  assert.equal(f.updates.at(-1).chatState, 'ready');
  assert.equal(f.updates.at(-1).messages.length, 0);
  assert.equal(f.timers.size, 0);
  f.watcher.close();
});

test('ending a live broadcast refreshes chat access for replay and cancels live polling', async () => {
  let html = page();
  const f = fixture(e => source(e, { html }));
  f.watcher.setChatEnabled(true);
  await f.flush();
  html = page('ENDED', 42);
  await f.run(15000);
  assert.equal(f.requests.filter(e => e.url.pathname.endsWith('/history')).at(-1).url.hostname, 'chatman-replay.pscp.tv');
  assert.equal(f.timers.size, 0);
  f.watcher.close();
});

test('failed chat retries are bounded and a closed request cannot update another player', async () => {
  const f = fixture(e => e.url.hostname === 'api.x.com' ? null : source(e));
  f.watcher.setChatEnabled(true);
  await f.flush();
  await f.run(10000);
  await f.run(10000);
  assert.equal(f.updates.at(-1).chatState, 'error');
  assert.ok(![...f.timers.values()].some(t => t.ms === 10000));
  f.watcher.close();
  const count = f.updates.length;
  await f.flush();
  assert.equal(f.updates.length, count);
  const pending = fixture(() => 'pending');
  pending.watcher.close();
  await pending.flush();
  assert.ok(pending.requests.every(e => e.xhr.aborted));
  assert.equal(pending.updates.length, 0);
});

test('a chat server outside the expected domain is rejected before sharing access tokens', async () => {
  const f = fixture(e => e.url.pathname.endsWith('accessChatPublic') ?
    { body: { endpoint: 'https://other.example', access_token: 'private' } } : source(e));
  f.watcher.setChatEnabled(true);
  await f.flush();
  assert.equal(f.updates.at(-1).chatState, 'error');
  assert.ok(!f.requests.some(e => e.url.hostname === 'other.example'));
  f.watcher.close();
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/network.js'), 'utf8');

// A fresh copy of the module with a controllable clock, timers, XHR and (optionally) the TV's service bridge.
function load({ tv = false, online = true } = {}) {
  const env = { clock: 1000000, timers: [], requests: [], bridges: [] };
  class Xhr {
    constructor() { this.headers = {}; this.readyState = 0; this.status = 0; env.requests.push(this); }
    open(method, url) { this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send() { this.sent = true; }
    abort() { this.aborted = true; if (this.onabort) this.onabort(); }
  }
  class Bridge {
    constructor() { env.bridges.push(this); }
    call(uri, params) { this.uri = uri; this.params = params; }
    cancel() { this.cancelled = true; }
  }
  const context = {
    Date: { now: () => env.clock }, Math, String, JSON, XMLHttpRequest: Xhr, navigator: { onLine: online },
    setInterval: fn => env.timers.push(fn), clearInterval: () => {}
  };
  if (tv) context.PalmServiceBridge = Bridge;
  context.window = context;
  vm.runInNewContext(source, context);
  env.net = context.HelloNetwork;
  env.rows = () => Object.fromEntries(env.net.rows());
  return env;
}

const MB = 1048576;

test('before anything is measured the rows say so', () => {
  assert.deepEqual(load().rows(), { Network: 'Online', 'Download speed': 'Not measured yet', 'Video server': 'Not checked yet' });
  assert.equal(load({ online: false }).rows().Network, 'Offline');
  assert.equal(load({ tv: true }).rows().Network, 'Checking');
});

test('stream segment downloads give current, average and lowest speed and the server response time', () => {
  const env = load();
  env.net.sample(7.5 * MB, 629, 250, 'https://video.twimg.com/amplify_video/1/a.m4s');
  assert.equal(env.rows()['Download speed'], '100 Mbps now · 100 average · 100 lowest');
  assert.equal(env.rows()['Video server'], 'video.twimg.com · Responding · 250 ms');
  env.net.sample(48000, 2, 30, 'https://video.twimg.com/amplify_video/1/audio.m4s');
  assert.match(env.rows()['Download speed'], /^100 Mbps now/, 'a tiny download says nothing about speed');
  env.clock += 30000;
  env.net.sample(7.5 * MB, 30000, 2400, 'https://video.twimg.com/amplify_video/1/b.m4s');
  assert.equal(env.rows()['Download speed'], '2.1 Mbps now · 51 average · 2.1 lowest');
  assert.equal(env.rows()['Video server'], 'video.twimg.com · Slow to respond · 2.4 s');
  env.clock += 121000;
  assert.equal(env.rows()['Download speed'], 'Not measured yet', 'old readings are forgotten');
});

test('the TV reports how it is connected', () => {
  const env = load({ tv: true });
  env.net.start();
  const bridge = env.bridges[0];
  assert.equal(bridge.uri, 'luna://com.webos.service.connectionmanager/getStatus');
  assert.deepEqual(JSON.parse(bridge.params), { subscribe: true });
  bridge.onservicecallback(JSON.stringify({ returnValue: true, isInternetConnectionAvailable: true,
    wired: { state: 'disconnected' }, wifi: { state: 'connected', ssid: 'HomeNet', displayName: 'HomeNet' } }));
  assert.equal(env.rows().Network, 'Wi-Fi · HomeNet · Internet reachable');
  bridge.onservicecallback(JSON.stringify({ returnValue: true, isInternetConnectionAvailable: false,
    wired: { state: 'disconnected' }, wifi: { state: 'connected', ssid: 'HomeNet' } }));
  assert.equal(env.rows().Network, 'Wi-Fi · HomeNet · No internet');
  bridge.onservicecallback(JSON.stringify({ returnValue: true, isInternetConnectionAvailable: true,
    wired: { state: 'connected' }, wifi: { state: 'connected', ssid: 'HomeNet' } }));
  assert.equal(env.rows().Network, 'Wired · Internet reachable');
  bridge.onservicecallback(JSON.stringify({ returnValue: true, wired: { state: 'disconnected' }, wifi: { state: 'disconnected' } }));
  assert.equal(env.rows().Network, 'Not connected');
  bridge.onservicecallback(JSON.stringify({ returnValue: false, errorText: 'Denied' }));
  assert.equal(env.rows().Network, 'Not connected', 'a refused call keeps the last reading');
  env.net.stop();
  assert.equal(bridge.cancelled, true);
});

test('a plain file is measured with a ranged request while the panel is open', () => {
  const env = load();
  env.net.start(() => 'https://video.twimg.com/amplify_video/1/vid/clip.mp4');
  const xhr = env.requests[0];
  assert.equal(xhr.url, 'https://video.twimg.com/amplify_video/1/vid/clip.mp4');
  assert.equal(xhr.headers.Range, 'bytes=0-4194303');
  assert.equal(env.rows()['Download speed'], 'Measuring');
  env.timers[0]();
  assert.equal(env.requests.length, 1, 'one request at a time');
  env.clock += 200; xhr.readyState = 2; xhr.onreadystatechange();
  env.clock += 800; xhr.status = 206; xhr.response = { byteLength: 4 * MB }; xhr.onload();
  assert.equal(env.rows()['Download speed'], '42 Mbps now · 42 average · 42 lowest');
  assert.equal(env.rows()['Video server'], 'video.twimg.com · Responding · 200 ms');
  env.timers[0]();
  assert.equal(env.requests.length, 1, 'a fresh reading is not repeated');
  env.clock += 13000; env.timers[0]();
  assert.equal(env.requests.length, 2);
});

test('a request that times out part-way still yields a speed; one with no answer marks the server', () => {
  const env = load();
  env.net.start(() => 'https://video.twimg.com/clip.mp4');
  let xhr = env.requests[0];
  env.clock += 300; xhr.readyState = 2; xhr.status = 206; xhr.onreadystatechange();
  env.clock += 7700; xhr.onprogress({ loaded: 2 * MB }); xhr.ontimeout();
  assert.equal(env.rows()['Download speed'], '2.2 Mbps now · 2.2 average · 2.2 lowest');
  env.clock += 13000; env.timers[0]();
  xhr = env.requests[1];
  env.clock += 8000; xhr.ontimeout();
  assert.equal(env.rows()['Video server'], 'video.twimg.com · Not responding');
  env.clock += 13000; env.timers[0]();
  xhr = env.requests[2];
  xhr.status = 403; xhr.readyState = 4; xhr.onreadystatechange(); xhr.response = { byteLength: 0 }; xhr.onload();
  assert.equal(env.rows()['Video server'], 'video.twimg.com · Error (HTTP 403)');
});

test('closing the panel abandons the request in flight', () => {
  const env = load();
  env.net.start(() => 'https://video.twimg.com/clip.mp4');
  env.net.stop();
  assert.equal(env.requests[0].aborted, true);
  env.timers[0]();
  assert.equal(env.requests.length, 1, 'nothing is requested without a source');
});

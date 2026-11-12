const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createBackend } = require('./pairing.test.cjs');
const root = path.resolve(__dirname, '../app');
const mockKey = 'gsk_' + 'fixture'.repeat(8);
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser.close(); });

async function fixture(t, options = {}) {
  const backend = await createBackend();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/pair') || url.pathname === '/connect' || url.pathname === '/nacl.js') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(url.href, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
      const result = await backend.fetch(request);
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.ttf') ? 'font/ttf' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
      let body = fs.readFileSync(file);
      if (options.staleStyles && file.endsWith('.css')) {
        // Reproduce a cached stylesheet from before the captions dialog was added.
        body = body.toString().replace(/\/\* Phone connection[\s\S]*?(?=\/\* Player \*\/)/, '');
      }
      res.end(body);
    }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  context.setDefaultTimeout(5000);
  const errors = [], records = { transcriptions: 0, audio: null, modelRequests: 0, failKey: !!options.failKey };
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(url => url.origin === origin && url.pathname === '/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HELLO_TV=' + JSON.stringify({ accounts: ['SpaceX'], pairingUrl: origin }) }));
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.hostname === 'api.groq.com') {
      if (url.pathname.endsWith('/models')) {
        records.modelRequests++;
        if (records.failKey) return json({ error: 'invalid' }, 401);
        assert.equal(route.request().headers().authorization, 'Bearer ' + mockKey);
        return json({ data: [{ id: 'whisper-large-v3-turbo' }] });
      }
      records.transcriptions++;
      assert.equal(route.request().headers().authorization, 'Bearer ' + mockKey);
      const body = route.request().postDataBuffer();
      const boundary = '--' + /boundary=(.+)$/.exec(route.request().headers()['content-type'])[1];
      const fileAt = body.indexOf(Buffer.from('filename="audio.m4a"'));
      assert.ok(fileAt > 0, 'only the player audio is uploaded');
      const start = body.indexOf(Buffer.from('\r\n\r\n'), fileAt) + 4;
      const end = body.indexOf(Buffer.from('\r\n' + boundary), start);
      records.audio = body.subarray(start, end);
      if (options.slowTranscription) await new Promise(resolve => setTimeout(resolve, 1000));
      if (options.rateLimit) return route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after', 'retry-after': '60' }, body: '{}' });
      return json({ text: 'Live captions <b>are safe</b>', segments: [{ start: 0, end: 12, text: 'Live captions <b>are safe</b>', no_speech_prob: 0.01 }] });
    }
    if (url.hostname === 'api.fxtwitter.com') return json({ results: [{ type: 'status', id: 'post1', text: 'Live launch https://x.com/i/broadcasts/TestCast', created_timestamp: Math.floor(Date.now() / 1000), author: { screen_name: 'SpaceX', name: 'SpaceX', avatar_url: origin + '/icon.png' } }] });
    if (url.hostname === 'x.com') return route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<meta property="og:video:url" content="https://prod.pscp.tv/TestCast/master.m3u8?type=live"><meta name="twitter:string:broadcast_state" content="RUNNING"><meta name="twitter:text:broadcast_title" content="Live launch">' });
    if (url.hostname === 'prod.pscp.tv') {
      const headers = { 'access-control-allow-origin': '*' };
      if (url.pathname.endsWith('/playback.ts')) return route.fulfill({ contentType: 'video/mp2t', headers, body: fs.readFileSync(path.join(__dirname, 'fixtures/playback.ts')) });
      if (url.pathname.endsWith('/720.m3u8')) return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', headers, body: '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:20\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:20.0,\nplayback.ts\n#EXT-X-ENDLIST\n' });
      return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', headers, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=1280x720\n720.m3u8\n' });
    }
    return route.abort();
  });
  const page = await context.newPage();
  t.after(async () => { await context.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, [], 'no uncaught application errors'); });
  await page.goto(origin);
  await page.locator('#homeChips .home-chip[aria-label="SpaceX"]').waitFor();
  return { page, context, origin, backend, records };
}
async function setup(page) {
  await page.locator('[data-nav="settings"]').click();
  await page.locator('.groq-setting').click();
  await page.locator('#groqSetup.on').waitFor();
}
async function connectDirect(page) {
  await setup(page);
  await page.locator('#groqManual').click();
  await page.locator('#groqKey').fill(mockKey);
  await page.locator('#groqSave').click();
  await page.locator('#groqTitle').filter({ hasText: 'ready' }).waitFor();
  await page.locator('#groqClose').click();
  await page.locator('#settingsClose').click();
}

test('a cached stylesheet cannot leak the closed captions dialog into Search', async t => {
  const { page } = await fixture(t, { staleStyles: true });
  await page.locator('[data-nav="search"]').click();
  await page.locator('[data-nav="home"]').hover();
  assert.equal(await page.locator('#groqSetup').isVisible(), false);
  assert.equal(await page.locator('#groqIntro').isVisible(), false);
  await page.evaluate(() => { HelloGroq.open(); HelloGroq.close(); });
  assert.equal(await page.locator('#groqSetup').isVisible(), false);
  assert.equal(await page.locator('#groqIntro').isVisible(), false);
});

test('a phone connects its own key through encrypted QR pairing and disconnect removes it', async t => {
  const { page, context, backend } = await fixture(t);
  await page.evaluate(() => {
    const original = window.qrcode;
    window.qrcode = function () {
      const result = original.apply(null, arguments), add = result.addData;
      result.addData = function (url) { window.testPairUrl = url; return add.call(result, url); };
      return result;
    };
  });
  await setup(page);
  await page.locator('#groqQr svg').waitFor();
  const link = await page.evaluate(() => window.testPairUrl);
  const phone = await context.newPage();
  await phone.goto(link);
  assert.equal(await phone.title(), 'Connect live captions · Clicker');
  await phone.locator('#key').fill(mockKey);
  await phone.locator('#connect').click();
  await phone.locator('body.done').waitFor();
  await page.locator('#groqTitle').filter({ hasText: 'ready' }).waitFor();
  assert.equal(await page.evaluate(() => HelloFavourites.secret('groq')), mockKey);
  assert.equal(JSON.stringify(Array.from(backend.bucket.records.values())).includes(mockKey), false);
  assert.equal(await phone.locator('#key').inputValue(), '');
  await page.locator('#groqClose').click();
  await page.reload();
  await setup(page);
  assert.equal(await page.locator('#groqTitle').innerText(), 'Groq is connected');
  await page.locator('#groqDisconnect').click();
  assert.equal(await page.evaluate(() => HelloFavourites.secret('groq')), '');
  assert.equal(await page.evaluate(() => HelloFavourites.settings().captions), '');
});

test('invalid keys stay masked and cannot enable transcription', async t => {
  const { page } = await fixture(t, { failKey: true });
  await setup(page);
  await page.locator('#groqManual').click();
  await page.locator('#groqKey').fill(mockKey);
  await page.locator('#groqSave').click();
  await page.locator('#groqStatus.error').waitFor();
  assert.match(await page.locator('#groqStatus').innerText(), /did not accept/);
  assert.equal(await page.locator('#groqKey').getAttribute('type'), 'password');
  assert.equal(await page.evaluate(() => HelloFavourites.secret('groq')), '');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#groqSetup').isVisible(), false);
  assert.equal(await page.locator('#groqKey').inputValue(), '');
});

test('live HLS uploads extracted playable audio and displays escaped Groq captions without a PC server', async t => {
  const { page, records } = await fixture(t);
  await connectDirect(page);
  await page.locator('#rows .card').first().click();
  await page.locator('#captions').filter({ hasText: 'Live captions' }).waitFor();
  assert.equal(await page.locator('#captions b').count(), 0);
  assert.equal(await page.locator('#captions').innerText(), 'Live captions <b>are safe</b>');
  assert.equal(records.transcriptions, 1);
  assert.ok(records.audio.includes(Buffer.from('ftyp')));
  assert.ok(records.audio.includes(Buffer.from('moof')));
  assert.equal(records.audio.includes(Buffer.from('vide')), false, 'no video track is uploaded');
  fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../test-results/groq-audio.m4a'), records.audio);
  await page.locator('#captionsButton').click();
  await page.locator('#captionsMenu .quality-option').filter({ hasText: /^Off/ }).click();
  assert.equal(await page.locator('#captions').innerText(), '');
  assert.equal(await page.evaluate(() => HelloFavourites.settings().captions), '');
});

test('a free-tier rate limit does not interrupt playback or rapidly repeat requests', async t => {
  const { page, records } = await fixture(t, { rateLimit: true });
  await connectDirect(page);
  await page.locator('#rows .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#captionsButton').click();
  await page.locator('#captionsMenu .quality-note').filter({ hasText: /free limit/ }).waitFor();
  assert.equal(await page.locator('#video').evaluate(video => video.paused), false);
  assert.equal(await page.locator('#errLabel').isVisible(), false);
  assert.equal(records.transcriptions, 1);
});

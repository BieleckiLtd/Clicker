const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const acorn = require('acorn');
const { chromium } = require('playwright');

let browser, server, origin;
const root = path.resolve(__dirname, '../app');
const profiles = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.ttf') ? 'font/ttf' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function clip(handle, n) {
  return {
    type: 'status', id: handle + n, text: handle + ' video ' + n,
    created_timestamp: Math.floor(Date.now() / 1000) - 3600 + profiles.indexOf(handle) * 10 + n,
    replies: 1, reposts: 2500, likes: 1200000,
    author: { name: handle.toUpperCase(), screen_name: handle, avatar_url: origin + '/icon.png' },
    media: { videos: [{ duration: 90, thumbnail_url: origin + '/icon.png', formats: [
      { url: 'https://video.twimg.com/' + handle + n + '/1280x720/clip.mp4', height: 720 },
      { url: 'https://video.twimg.com/' + handle + n + '/640x360/clip.mp4', height: 360 },
      { url: 'https://video.twimg.com/' + handle + n + '/3840x2160/clip.mp4', height: 2160 }
    ] }] }
  };
}

async function fixture(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], requests = [];
  let broadcastRequests = 0;
  let chatRequests = 0;
  page.on('pageerror', err => errors.push(err.message));
  await page.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (options.broadcastChat && url.hostname === 'api.x.com') return json({ chatToken: 'chat-token' });
    if (options.broadcastChat && url.pathname.endsWith('/accessChatPublic')) return json({
      endpoint: 'https://chatman-live.pscp.tv', access_token: 'live-access',
      replay_endpoint: 'https://chatman-replay.pscp.tv', replay_access_token: 'replay-access' });
    if (options.broadcastChat && url.pathname.endsWith('/chatapi/v1/history')) {
      chatRequests++;
      if (options.chatFailure) return json({ error: 'unavailable' }, 503);
      return json({ messages: [{ kind: 1, payload: JSON.stringify({ sender: { display_name: 'Viewer', username: 'viewer' },
        body: JSON.stringify({ type: 1, uuid: 'first', timestamp: 1, body: 'Hello 🪩 <b>literal chat</b>' }) }) }].concat(chatRequests > 1 ?
        [{ kind: 1, payload: JSON.stringify({ sender: { display_name: 'Second viewer' }, body: JSON.stringify({ type: 1, uuid: 'next', timestamp: 2, body: 'New live message' }) }) }] : []), cursor: '' });
    }
    if (url.pathname === '/2/typeahead') {
      const q = url.searchParams.get('q');
      if (options.queryDelay) await new Promise(resolve => setTimeout(resolve, options.queryDelay(q)));
      if (options.searchFailure) return json({ message: 'unavailable' }, 503);
      const handles = options.empty ? [] : q === 'moon' ? ['moonchannel'] : profiles;
      return json({ users: handles.map(handle => ({ screen_name: handle, name: handle.toUpperCase(), avatar_url: origin + '/icon.png' })) });
    }
    if (url.pathname.startsWith('/2/conversation/')) {
      if (options.commentsFailure) return json({ code: 404, replies: null }, 404);
      const next = url.searchParams.has('cursor');
      return json({ code: 200, status: { text: 'Full post text\nSecond paragraph kept in full.' }, replies: [{ id: next ? 'reply2' : 'reply1', author: { name: '𝕍iewer', screen_name: 'viewer' }, text: next ? 'Second page reply' : 'Great launch! 🪩 🚀 🇬🇧 👩🏽‍🚀 Café <b>literal text</b>' }], cursor: { bottom: next ? null : 'page2' } });
    }
    const savedPost = /^\/2\/status\/(.+?)(\d+)$/.exec(url.pathname);
    if (savedPost) {
      if (options.historyDelay) await new Promise(resolve => setTimeout(resolve, options.historyDelay));
      return options.historyFailure ? json({ code: 404 }, 404) : json({ code: 200, status: clip(savedPost[1], Number(savedPost[2])) });
    }
    const match = /^\/2\/profile\/([^/]+)\/(statuses|media)$/.exec(url.pathname);
    if (match) {
      const handle = match[1];
      if (options.homeFailure && !profiles.includes(handle)) return json({ message: 'unavailable' }, 503);
      if (options.timelineDelay && profiles.includes(handle)) await new Promise(resolve => setTimeout(resolve, options.timelineDelay(handle)));
      if ((options.timelineFailure === 'all' && profiles.includes(handle)) || options.timelineFailure === handle) return json({ message: 'unavailable' }, 503);
      if (options.noVideos && profiles.includes(handle)) return json({ results: [] });
      const results = options.homeStatuses && handle === 'SpaceX' ? options.homeStatuses : [clip(handle, 1), clip(handle, 2)];
      if (options.olderHome && !profiles.includes(handle)) results.forEach(status => { status.created_timestamp = Math.floor(Date.now() / 1000) - 108000; });
      if (handle === 'beta') results.push(clip('alpha', 1));
      if (handle === 'alpha') results.push({
        type: 'status', id: 'cast-post', text: 'Live launch https://x.com/i/broadcasts/TestCast', created_timestamp: 1000,
        author: { name: 'ALPHA', screen_name: 'alpha', avatar_url: options.broadcastAvatar || '' }
      });
      if (options.captions) results.forEach(status => status.media && status.media.videos[0].formats.unshift({
        url: 'https://video.twimg.com/' + status.id + '/pl/master.m3u8?tag=1', container: 'm3u8' }));
      if (handle === 'alpha' && options.manyBroadcasts) {
        for (let n = 1; n < 7; n++) results.push({
          type: 'status', id: 'cast-post-' + n, text: 'Launch https://x.com/i/broadcasts/TestCast' + n,
          created_timestamp: 1000 - n, author: { name: 'ALPHA', screen_name: 'alpha' }
        });
      }
      return json({ results });
    }
    if (url.hostname === 'x.com') {
      broadcastRequests++;
      if (options.recoveryDelay && broadcastRequests > 1) await new Promise(resolve => setTimeout(resolve, options.recoveryDelay));
      if (options.broadcastDelay) await new Promise(resolve => setTimeout(resolve, options.broadcastDelay));
      if (options.broadcastFailure) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body:
        '<meta property="og:video:url" content="https://prod.pscp.tv/TestCast/playlist.m3u8?type=live">' +
        '<meta name="twitter:string:broadcast_state" content="' + (options.replay ? 'ENDED' : 'RUNNING') + '">' +
        '<meta name="twitter:text:broadcast_title" content="Live launch">' +
        '<meta property="og:image" content="' + (options.broadcastThumbnail === undefined ? 'https://pbs.twimg.com/test.jpg' : options.broadcastThumbnail) + '">' +
        (options.broadcastChat ? '<meta name="twitter:text:broadcast_media_key" content="28_123">' +
          'broadcast_by_rest_id:$R[15]={broadcast_id:"TestCast",chat_option:2,total_watched:99999,total_watching:123,user_results:$R[17]={}' : '')
      });
    }
    if (options.failedImages && options.failedImages.includes(url.pathname)) return route.fulfill({ status: 404, body: '' });
    if (url.hostname.endsWith('.video.pscp.tv')) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'icon.png')) });
    if (url.hostname === 'prod.pscp.tv') {
      if (url.pathname.endsWith('/playback.ts')) return route.fulfill({ contentType: 'video/mp2t', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(__dirname, 'fixtures/playback.ts')) });
      if (/\/(720|360|2160)\.m3u8$/.test(url.pathname)) {
        if (options.slowQuality && url.pathname.endsWith('/2160.m3u8')) await new Promise(resolve => setTimeout(resolve, options.slowQuality));
        const playable = options.playable && (!options.expiredLink || broadcastRequests > 1) && !(options.failHighQuality && !url.pathname.endsWith('/360.m3u8'));
        return route.fulfill({ status: playable ? 200 : 404, contentType: 'application/vnd.apple.mpegurl', headers: { 'access-control-allow-origin': '*' }, body: playable ? '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:20\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:20.0,\nplayback.ts\n#EXT-X-ENDLIST\n' : '' });
      }
      return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', headers: { 'access-control-allow-origin': '*' }, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=640x360\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=3840x2160\n2160.m3u8\n' });
    }
    if (url.hostname === 'api.microlink.io') return json({ status: 'fail' });
    if (url.hostname === 'pbs.twimg.com') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'icon.png')) });
    if (url.hostname === 'video.twimg.com' && options.captions && /\.(m3u8|vtt)$/.test(url.pathname)) {
      const text = url.pathname.endsWith('/pl/master.m3u8')
        ? '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="en (auto-generated)",DEFAULT=NO,AUTOSELECT=YES,URI="/subs/en.m3u8",LANGUAGE="en"\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720,SUBTITLES="subs"\nvideo/720.m3u8\n' +
          (options.uhdStream ? '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=' + (options.uhdStream === 'vertical' ? '2160x3840' : '3840x2160') + ',SUBTITLES="subs"\nvideo/2160.m3u8\n' : '')
        : url.pathname === '/subs/en.m3u8'
          ? '#EXTM3U\n#EXT-X-TARGETDURATION:30\n#EXTINF:30,\n/subtitles/en.vtt\n#EXT-X-ENDLIST\n'
          : 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n<X-word-ms ms=1>Hello &lt;b&gt;captions&lt;/b&gt; &amp; more</X-word-ms>\n\n' +
            '00:00:06.000 --> 00:00:08.000\nSecond line\n';
      return route.fulfill({ contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: text });
    }
    if (url.hostname === 'video.twimg.com' && options.playable) {
      if (options.failHighQuality && !url.pathname.includes('/640x360/')) return route.fulfill({ status: 404, body: '' });
      const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/playback.mp4'));
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
      const headers = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
      if (!range) return route.fulfill({ contentType: 'video/mp4', headers, body: bytes });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      headers['content-range'] = 'bytes ' + start + '-' + end + '/' + bytes.length;
      return route.fulfill({ status: 206, contentType: 'video/mp4', headers, body: bytes.subarray(start, end + 1) });
    }
    return route.abort();
  });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no uncaught app errors'); });
  if (options.storedHistory) await page.addInitScript(entry => {
    localStorage.setItem('hellotv.history', JSON.stringify({ [entry.id]: entry }));
    localStorage.setItem('hellotv.positions', JSON.stringify({ [entry.id]: { time: 10, duration: 20, at: entry.watchedAt } }));
  }, { id: 't:zeta2', postId: 'zeta2', title: 'Saved video', watchedAt: Date.now() });
  await page.goto(origin);
  await page.locator('#rows .card, #rows .message').first().waitFor();
  await page.locator('[data-nav="search"]').click();
  return { page, requests };
}

async function query(page, text = 'nasa') {
  await page.keyboard.type(text);
  await page.locator('#results .result').first().waitFor();
  await page.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
}

async function chip(page, name) {
  await page.locator('#chips .chip').getByText(name, { exact: true }).click();
}

async function remote(page, keyCode) {
  await page.evaluate(code => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true })), keyCode);
}

async function exitPlayer(page) {
  await page.keyboard.press('Escape');
  if (await page.locator('#app').getAttribute('class') === 'screen-player') await page.keyboard.press('Escape');
}

test('all shipped scripts parse as ES5 for webOS 4.5', () => {
  for (const file of fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.js'))) {
    acorn.parse(fs.readFileSync(path.join(root, file), 'utf8'), { ecmaVersion: 5 });
  }
});

for (const example of [
  { name: 'uses the stream frame', thumbnail: 'https://prod-fastly-us-east-1.video.pscp.tv/live_thumbnail/latest.jpg?token=signed&service=proxsee', className: 'shot' },
  { name: 'uses the channel logo when no frame is supplied', thumbnail: '', className: 'shot channel-shot' },
  { name: 'uses the channel logo when the frame fails', thumbnail: 'https://pbs.twimg.com/broken-frame.jpg', failedImages: ['/broken-frame.jpg'], className: 'shot channel-shot' },
  { name: 'uses the app logo if both frame and channel logo fail', thumbnail: 'https://pbs.twimg.com/broken-frame.jpg', failedImages: ['/broken-frame.jpg', '/channel.jpg'], className: 'shot logo-shot' }
]) test('broadcast artwork ' + example.name + ' in Home and Search', async t => {
  const avatar = 'https://pbs.twimg.com/channel.jpg';
  const { page } = await fixture(t, {
    broadcastThumbnail: example.thumbnail, broadcastAvatar: avatar, failedImages: example.failedImages,
    homeStatuses: [{ type: 'status', id: 'home-cast', text: 'Live launch https://x.com/i/broadcasts/TestCast',
      created_timestamp: Math.floor(Date.now() / 1000), author: { name: 'SpaceX', screen_name: 'SpaceX', avatar_url: avatar } }]
  });
  await query(page);
  await page.locator('#results .badge.live').waitFor();
  await chip(page, 'Live');
  const expected = example.className === 'shot' ? example.thumbnail : example.className === 'shot channel-shot' ? avatar : origin + '/clicker-symbol.svg';
  for (const host of ['#results', '#rows']) {
    if (host === '#rows') await page.locator('[data-nav="home"]').click();
    const image = page.locator(host + ' .card').filter({ has: page.locator('.badge.live') }).first().locator('.shot');
    await page.waitForFunction(({ host, expected, className }) => {
      const badge = document.querySelector(host + ' .badge.live');
      const image = badge && badge.parentNode.querySelector('.shot');
      return image && image.src === expected && image.className === className && image.complete && image.naturalWidth > 0;
    }, { host, expected, className: example.className });
    assert.equal(await image.evaluate(node => getComputedStyle(node).visibility), 'visible');
    if (example.className === 'shot channel-shot') {
      assert.equal(await image.evaluate(node => getComputedStyle(node).width), '112px');
      assert.equal(await image.evaluate(node => getComputedStyle(node).opacity), '1');
    }
  }
});

test('search aggregates six channels, deduplicates clips, resolves Live and filters Channels', async t => {
  const { page, requests } = await fixture(t);
  await query(page);
  await page.locator('#results .badge.live').waitFor();
  assert.equal(await page.locator('#results .card').count(), 13);
  await chip(page, 'Live');
  assert.equal(await page.locator('#results .card').count(), 1);
  assert.match(await page.locator('#results').innerText(), /Live launch/);
  await chip(page, 'Videos');
  assert.equal(await page.locator('#results .card').count(), 12);
  await chip(page, 'Channels');
  assert.equal(await page.locator('#results .channel').count(), 8);
  assert.equal(requests.some(url => /\/profile\/(eta|theta)\//.test(url)), false);
  assert.equal(requests.some(url => /\/2\/search/.test(url)), false);
});

test('remote traverses grid rows, scrolls, handles final row, chips, keyboard and rail', async t => {
  const { page } = await fixture(t);
  await query(page);
  await page.locator('#results .badge.live').waitFor();
  await chip(page, 'All');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#results .result.focused').count(), 1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#results .result:nth-child(5).focused').count(), 1);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#results .result:nth-child(8).focused').count(), 1);
  assert.ok(await page.locator('#results').evaluate(el => el.scrollTop) > 0);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#results .result:nth-child(13).focused').count(), 1);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#keys .focused').count(), 1);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#chips .focused').count(), 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#chips .focused').count(), 1);
  await page.keyboard.press('ArrowUp');
  for (let n = 0; n < 9; n++) await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#nav .focused').getAttribute('data-nav'), 'search');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#nav .focused').getAttribute('data-nav'), 'home');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-browse');
});

test('channel OK adds and removes favourites, refreshes Home and survives reload', async t => {
  const { page } = await fixture(t);
  await query(page);
  await chip(page, 'Channels');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#results .channel').first().innerText(), /OK to remove/);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#homeChips .home-chip')).some(el => el.textContent === 'ALPHA'));
  assert.equal(await page.evaluate(() => HelloCatalog.isFavourite('alpha')), true);
  await page.reload();
  await page.locator('[data-nav="search"]').click();
  await query(page);
  await chip(page, 'Channels');
  assert.match(await page.locator('#results .channel').first().innerText(), /OK to remove/);
  await page.locator('#results .channel').first().click();
  assert.match(await page.locator('#results .channel').first().innerText(), /OK to add/);
  assert.equal(await page.evaluate(() => HelloCatalog.isFavourite('alpha')), false);
});

test('opening a video and Back restores search filter and focused result', async t => {
  const { page } = await fixture(t);
  await query(page);
  await chip(page, 'Videos');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const title = await page.locator('#results .focused .ttl').innerText();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  assert.equal(await page.locator('#ptitle').innerText(), title);
  assert.deepEqual(await page.locator('#psub .pstat').evaluateAll(stats => stats.map(s => [s.dataset.stat, s.textContent, s.getAttribute('aria-label'), !!s.querySelector('svg')])), [
    ['comment', '1', '1 comment', true], ['repost', '2.5K', '2.5K reposts', true], ['like', '1.2M', '1.2M likes', true]]);
  assert.match(await page.locator('#video').getAttribute('src'), /video\.twimg\.com/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  assert.equal(await page.locator('#chrome').getAttribute('class'), 'hide');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
  assert.equal(await page.locator('#results .focused .ttl').innerText(), title);
  assert.equal(await page.locator('#chips .selected .chip-label').innerText(), 'Videos');
});

test('a late response cannot overwrite a new query during the debounce', async t => {
  const { page, requests } = await fixture(t, { queryDelay: q => q === 'nasa' ? 450 : 0 });
  await page.keyboard.type('nasa');
  await page.waitForRequest(req => req.url().includes('typeahead?q=nasa'));
  await page.locator('#keys .key').getByText('clear', { exact: true }).click();
  await page.keyboard.type('moon');
  await page.waitForFunction(() => document.getElementById('results').textContent.indexOf('moonchannel video') !== -1);
  assert.equal(await page.locator('#results .card').count(), 2);
  assert.equal(await page.locator('#query').innerText(), 'moon');
  assert.ok(requests.some(url => url.includes('typeahead?q=moon')));
});

test('background live sorting preserves the focused video', async t => {
  const { page } = await fixture(t, { broadcastDelay: 1800 });
  await query(page);
  await chip(page, 'All');
  await page.keyboard.press('ArrowDown');
  const title = await page.locator('#results .focused .ttl').innerText();
  await page.locator('#results .badge.live').waitFor();
  assert.equal(await page.locator('#results .focused .ttl').innerText(), title);
  assert.equal(await page.locator('#results .card').first().locator('.badge.live').count(), 1);
});

test('background resolution is limited to the first six broadcasts', async t => {
  const { page, requests } = await fixture(t, { manyBroadcasts: true });
  await query(page);
  await page.waitForFunction(() => document.querySelectorAll('#results .badge.live').length === 6);
  assert.equal(requests.filter(url => url.startsWith('https://x.com/i/broadcasts/')).length, 6);
  assert.equal(await page.locator('#results .badge').getByText('BROADCAST', { exact: true }).count(), 1);
});

test('failed broadcast resolution does not label a stream as live or replay', async t => {
  const { page } = await fixture(t, { broadcastFailure: true });
  await query(page);
  await page.waitForFunction(() => document.querySelectorAll('#results .badge').length === 0);
  await chip(page, 'Live');
  assert.match(await page.locator('#results').innerText(), /No live streams/);
});

test('empty and short queries show useful hints without requests', async t => {
  const { page, requests } = await fixture(t, { empty: true });
  await page.keyboard.type('n');
  assert.match(await page.locator('#results').innerText(), /at least two/);
  assert.equal(requests.some(url => url.includes('typeahead')), false);
  await page.keyboard.type('asa');
  await page.waitForFunction(() => document.getElementById('results').textContent.indexOf('No matching channels') !== -1);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#query').innerText(), 'nas');
  await page.locator('#keys .key').getByText('clear', { exact: true }).click();
  assert.match(await page.locator('#results').innerText(), /Search a channel/);
});

test('search service errors differ from no matches', async t => {
  const { page } = await fixture(t, { searchFailure: true });
  await page.keyboard.type('nasa');
  await page.waitForFunction(() => document.getElementById('results').textContent.indexOf("Couldn't load") !== -1);
  assert.equal(await page.locator('#results .result').count(), 0);
});

test('channels without media remain addable and Live has an empty hint', async t => {
  const { page } = await fixture(t, { noVideos: true });
  await page.keyboard.type('nasa');
  await page.waitForFunction(() => document.getElementById('results').textContent.indexOf('No videos') !== -1);
  await chip(page, 'Live');
  assert.match(await page.locator('#results').innerText(), /No live streams/);
  await chip(page, 'Channels');
  assert.equal(await page.locator('#results .channel').count(), 8);
});

test('partial timeline failures keep successful videos and show a retry message', async t => {
  const { page } = await fixture(t, { timelineFailure: 'beta' });
  await query(page);
  assert.ok(await page.locator('#results .card').count() >= 10);
  assert.match(await page.locator('#toast').innerText(), /couldn't load/);
});

test('total timeline failure still exposes matching channels', async t => {
  const { page } = await fixture(t, { timelineFailure: 'all' });
  await page.keyboard.type('nasa');
  await page.waitForFunction(() => document.getElementById('results').textContent.indexOf("Couldn't load") !== -1);
  await chip(page, 'Channels');
  assert.equal(await page.locator('#results .channel').count(), 8);
});

test('three columns and keyboard fit the 1080p canvas', async t => {
  const { page } = await fixture(t);
  await query(page);
  const layout = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    return { right: rect(document.getElementById('searchRight')), left: rect(document.getElementById('searchLeft')),
      cards: Array.from(document.querySelectorAll('#results .card')).slice(0, 4).map(rect),
      keys: Array.from(document.querySelectorAll('#keys .key')).map(rect) };
  });
  assert.equal(layout.cards[0].top, layout.cards[2].top);
  assert.ok(layout.cards[3].top > layout.cards[0].top);
  assert.ok(layout.cards[2].right <= layout.right.right);
  assert.ok(layout.keys.every(key => key.right <= layout.left.right));
});

test('Home has four complete columns with no hero and fixed header while scrolling', async t => {
  const { page } = await fixture(t);
  await page.locator('[data-nav="home"]').click();
  assert.equal(await page.locator('#rows .hero').count(), 0);
  const before = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#rows .card')).map(el => el.getBoundingClientRect());
    return { top: document.getElementById('homeHeader').getBoundingClientRect().top,
      positions: cards.map(r => ({ left: r.left, top: r.top, right: r.right })) };
  });
  assert.equal(before.positions[0].top, before.positions[3].top);
  assert.ok(before.positions[4].top > before.positions[0].top);
  assert.ok(before.positions[3].right < 1920);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#rows .card:nth-child(6).focused').count(), 1);
  assert.equal(await page.locator('#homeHeader').evaluate(el => el.getBoundingClientRect().top), before.top);
});

test('saved channel filter shows its videos and Back returns to Hot', async t => {
  const { page } = await fixture(t);
  await page.locator('[data-nav="home"]').click();
  await page.locator('#homeChips .home-chip[aria-label="NASA"]').click();
  assert.equal(await page.locator('#homeTitle').innerText(), 'NASA');
  assert.equal(await page.locator('#rows .card').count(), 2);
  assert.ok((await page.locator('#rows .ttl').allTextContents()).every(title => title.startsWith('NASA ')));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#homeTitle').innerText(), 'Hot right now');
  assert.equal(await page.locator('#homeChips .selected').innerText(), 'Hot');
});

test('Hot ranks recent popularity, keeps older live streams, and leaves Videos chronological', async t => {
  const now = Math.floor(Date.now() / 1000);
  const recent = (n, hours, views) => ({ ...clip('SpaceX', n), created_timestamp: now - hours * 3600, views });
  const { page } = await fixture(t, { homeStatuses: [
    recent(1, 1, 100), recent(2, 8, 100000), recent(3, 2, 100000), recent(4, 30, 50000000),
    { ...recent(5, 0, 50000000), created_timestamp: 0 },
    { type: 'status', id: 'older-live', text: 'Live launch https://x.com/i/broadcasts/TestCast', created_timestamp: now - 72 * 3600,
      author: { name: 'SpaceX', screen_name: 'SpaceX' } }
  ] });
  await page.locator('[data-nav="home"]').click();
  await page.locator('#rows .badge.live').waitFor();
  const titles = await page.locator('#rows .ttl').allTextContents();
  assert.deepEqual(titles.slice(0, 3), ['Live launch', 'SpaceX video 3', 'SpaceX video 2']);
  assert.ok(titles.includes('SpaceX video 1'));
  assert.ok(!titles.includes('SpaceX video 4'), 'old totals cannot dominate Hot');
  assert.ok(!titles.includes('SpaceX video 5'), 'an unknown date cannot count as recent');
  await page.locator('#homeChips .home-chip[aria-label="Videos"]').click();
  const videos = await page.locator('#rows .ttl').allTextContents();
  const spacex = videos.filter(title => title.startsWith('SpaceX video'));
  assert.deepEqual(spacex, ['SpaceX video 1', 'SpaceX video 3', 'SpaceX video 2', 'SpaceX video 4', 'SpaceX video 5']);
  assert.equal(await page.locator('#rows .badge.live').count(), 0);
});

test('Home channels drag before and after each other, preserve selection and retain their order', async t => {
  const { page } = await fixture(t);
  await page.locator('[data-nav="home"]').click();
  const channels = () => page.locator('#homeChips [data-channel]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-channel')));
  const channel = handle => page.locator('#homeChips [data-channel="' + handle + '"]');
  await channel('spacex').click();
  const title = await page.locator('#homeTitle').innerText();
  const cards = await page.locator('#rows .ttl').allTextContents();
  const station = await channel('space_station').boundingBox();
  await channel('spacex').dragTo(channel('space_station'), { targetPosition: { x: station.width - 4, y: 28 } });
  assert.deepEqual(await channels(), ['nasa', 'nasakennedy', 'space_station', 'spacex']);
  assert.equal(await page.locator('#homeTitle').innerText(), title);
  assert.deepEqual(await page.locator('#rows .ttl').allTextContents(), cards);
  assert.equal(await page.locator('#homeChips .selected').getAttribute('data-channel'), 'spacex');
  await channel('space_station').dragTo(channel('nasa'), { targetPosition: { x: 4, y: 28 } });
  const expected = ['space_station', 'nasa', 'nasakennedy', 'spacex'];
  assert.deepEqual(await channels(), expected);
  assert.deepEqual(await page.evaluate(() => HelloFavourites.get().map(item => item.handle.toLowerCase())), expected);
  await page.locator('[data-nav="refresh"]').click();
  await page.waitForTimeout(100);
  assert.deepEqual(await channels(), expected);
  await page.reload();
  await channel('spacex').waitFor();
  assert.deepEqual(await channels(), expected);
});

test('dragging channels onto fixed filters or themselves leaves the saved order intact', async t => {
  const { page } = await fixture(t);
  await page.locator('[data-nav="home"]').click();
  await page.evaluate(() => HelloFavourites.set(['SpaceX', 'NASA', 'NASAKennedy', 'Space_Station', 'alpha', 'beta', 'gamma'].map(handle => ({ handle, name: handle }))));
  await page.locator('[data-nav="refresh"]').click();
  await page.locator('#homeChips [data-channel="gamma"]').waitFor();
  const channel = handle => page.locator('#homeChips [data-channel="' + handle + '"]');
  const order = () => page.locator('#homeChips [data-channel]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-channel')));
  const original = await order();
  await channel('spacex').dragTo(page.locator('#homeChips .home-chip[aria-label="Live"]'));
  assert.deepEqual(await order(), original);
  await channel('spacex').dragTo(channel('spacex'));
  assert.deepEqual(await order(), original);
  await channel('gamma').dragTo(channel('spacex'), { targetPosition: { x: 4, y: 28 } });
  assert.deepEqual(await order(), ['gamma'].concat(original.slice(0, -1)));
  assert.equal(await page.locator('#homeChips [draggable="true"]').count(), 7);
  assert.equal(await page.locator('#homeChips .dragging, #homeChips .drop-before, #homeChips .drop-after').count(), 0);
});

test('dragging an avatar on a scaled PC preview uses a compact native badge', async t => {
  const { page } = await fixture(t);
  await page.setViewportSize({ width: 960, height: 700 });
  await page.locator('[data-nav="home"]').click();
  const avatar = page.locator('#homeChips [data-channel="spacex"] .home-avatar');
  assert.equal(await avatar.getAttribute('draggable'), 'false');
  await page.evaluate(() => {
    const original = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (node, x, y) {
      const image = node.querySelector('img').getBoundingClientRect();
      const badge = node.getBoundingClientRect();
      window.dragBadge = { width: badge.width, height: badge.height, imageWidth: image.width, imageHeight: image.height, text: node.textContent };
      return original.call(this, node, x, y);
    };
  });
  const from = await avatar.boundingBox();
  const to = await page.locator('#homeChips [data-channel="nasa"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width - 3, to.y + to.height / 2, { steps: 5 });
  const badge = await page.evaluate(() => window.dragBadge);
  assert.equal(badge.height, 44, 'badge stays small at the PC viewport scale');
  assert.ok(badge.width <= 240);
  assert.equal(badge.text, 'SPACEX');
  assert.equal(badge.imageWidth, 28);
  assert.equal(badge.imageHeight, 28);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('.channel-drag-preview').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#homeChips .dragging, #homeChips .drop-after').count(), 0);
  assert.equal(await page.locator('#homeChips .home-chip[style*="width"]').count(), 0);
  assert.deepEqual(await page.locator('#homeChips [data-channel]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-channel'))),
    ['spacex', 'nasa', 'nasakennedy', 'space_station']);
});

test('empty Hot explains how to browse older content without hiding saved channels', async t => {
  const { page } = await fixture(t, { olderHome: true });
  await page.locator('[data-nav="home"]').click();
  assert.match(await page.locator('#rows .message').innerText(), /Nothing hot right now[\s\S]*Choose Videos/);
  await page.locator('#homeChips .home-chip[aria-label="Videos"]').click();
  assert.equal(await page.locator('#rows .card').count(), 8);
  await page.locator('#homeChips .home-chip[aria-label="SPACEX"]').click();
  assert.equal(await page.locator('#rows .card').count(), 2);
});

test('sidebar cannot overlap Home or Search when focused', async t => {
  const { page } = await fixture(t);
  // The rail opens underneath the page, which slides aside: content stays on top while it
  // moves, and once settled the two sit side by side.
  const metrics = id => page.evaluate(contentId => {
    const content = document.getElementById(contentId).getBoundingClientRect();
    const hit = document.elementFromPoint(content.left + 8, content.top + 40);
    return { rail: document.getElementById('nav').getBoundingClientRect().right, content: content.left,
      covered: document.getElementById('nav').contains(hit) };
  }, id);
  await page.locator('[data-nav="search"]').hover();
  assert.equal((await metrics('searchLeft')).covered, false);
  await page.waitForTimeout(400);
  let settled = await metrics('searchLeft');
  assert.ok(settled.content > settled.rail && !settled.covered);
  await page.locator('[data-nav="home"]').click();
  await page.keyboard.press('ArrowLeft');
  assert.equal((await metrics('rows')).covered, false);
  await page.waitForTimeout(400);
  settled = await metrics('rows');
  assert.ok(settled.content > settled.rail && !settled.covered);
});

test('search shows progress and channels before the slowest timeline finishes', async t => {
  const { page } = await fixture(t, { timelineDelay: handle => handle === 'zeta' ? 2500 : 200 });
  await page.keyboard.type('nasa');
  assert.equal(await page.locator('#searchStatus.loading').count(), 1);
  await page.waitForFunction(() => document.getElementById('searchStatus').textContent.indexOf('Loading videos') !== -1);
  await chip(page, 'Channels');
  assert.equal(await page.locator('#results .channel').count(), 8);
  assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'true');
  await chip(page, 'Videos');
  await page.locator('#results .card').first().waitFor();
  assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'true');
  await page.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#chips .chip-count').nth(0).innerText(), '13');
  assert.equal(await page.locator('#chips .chip-count').nth(3).innerText(), '8');
});

test('TV delete key uses an SVG and actually deletes a character', async t => {
  const { page } = await fixture(t);
  await page.keyboard.type('nasa');
  const del = page.getByRole('button', { name: 'Delete character' });
  assert.equal(await del.locator('svg').count(), 1);
  await del.click();
  assert.equal(await page.locator('#query').innerText(), 'nas');
});

test('on-screen Back closes playback and sidebar Back closes Search', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  const title = await page.locator('#results .card .ttl').first().innerText();
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  await page.locator('#playerBack').click();
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true);
  assert.equal(await page.locator('#video').getAttribute('src'), null);
  assert.equal(await page.locator('#results .focused .ttl').innerText(), title);
  assert.equal(await page.locator('#chips .selected .chip-label').innerText(), 'Videos');
  await page.locator('[data-nav="back"]').click();
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-browse');
});

test('Back cancels opening a broadcast rather than jumping back into playback later', async t => {
  const { page } = await fixture(t, { broadcastDelay: 1300 });
  await query(page);
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).first().click();
  await page.keyboard.press('Escape');
  await page.waitForResponse(response => response.url().startsWith('https://prod.pscp.tv/'));
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-browse');
});

test('quality menu switches MP4 resolution and includes source 4K', async t => {
  const { page } = await fixture(t);
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  assert.match(await page.locator('#video').getAttribute('src'), /1280x720/);
  await remote(page, 406);
  assert.match(await page.locator('#qualityMenu').innerText(), /2160p · 4K/);
  await page.locator('#qualityMenu .quality-option').getByText('360p', { exact: true }).click();
  assert.match(await page.locator('#video').getAttribute('src'), /640x360/);
  assert.match(await page.locator('#qualityButton').innerText(), /360p/);
  await page.locator('#qualityButton').click();
  await page.locator('#qualityMenu .quality-option').getByText('2160p · 4K', { exact: true }).click();
  assert.match(await page.locator('#video').getAttribute('src'), /3840x2160/);
});

test('Home autoplay follows the selected board and remembers 4K through a lower-quality video and reload', async t => {
  const homeStatuses = [1, 2, 3, 4].map(n => clip('SpaceX', n));
  homeStatuses[1].media.videos[0].formats.pop();
  const { page } = await fixture(t, { playable: true, homeStatuses });
  await page.locator('[data-nav="home"]').click();
  await page.locator('#homeChips .home-chip[data-channel="spacex"]').click();
  const board = page.locator('#rows .card');
  assert.deepEqual(await board.locator('.ttl').allTextContents(),
    ['SpaceX video 4', 'SpaceX video 3', 'SpaceX video 2', 'SpaceX video 1']);
  await board.nth(1).click();
  const video = page.locator('#video');
  const playing = (id, quality) => page.waitForFunction(({ id, quality }) => {
    const v = document.getElementById('video');
    return v.readyState >= 3 && !v.paused && v.currentSrc.includes('/SpaceX' + id + '/' + quality + '/');
  }, { id, quality });
  const finish = () => video.evaluate(v => { v.currentTime = v.duration - 0.15; });

  await playing(3, '1280x720');
  await remote(page, 406);
  await page.getByRole('button', { name: '2160p · 4K', exact: true }).click();
  await playing(3, '3840x2160');
  await finish();
  await playing(2, '1280x720');
  assert.equal(await page.locator('#qualityLabel').textContent(), '720p');
  assert.equal(await page.evaluate(() => HelloFavourites.progress('t:SpaceX3').completed), true);
  await finish();
  await playing(1, '3840x2160');
  assert.equal(await page.locator('#qualityLabel').textContent(), '2160p · 4K');
  await finish();
  await page.waitForFunction(() => document.getElementById('video').ended);
  assert.equal(await page.locator('#ptitle').textContent(), 'SpaceX video 1');
  await page.locator('#playerBack').click();
  assert.equal(await board.filter({ has: page.locator('.ttl', { hasText: 'SpaceX video 3' }) }).getAttribute('class'), 'card focused');

  await page.reload();
  await page.locator('#homeChips .home-chip[data-channel="spacex"]').click();
  await board.first().click();
  await playing(4, '3840x2160');
});

test('Down opens the filmstrip and OK can play earlier and later cards from the board', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  const titles = await page.locator('#results .card .ttl').allTextContents();
  await page.locator('#results .card').nth(2).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  const strip = page.locator('#filmstrip');
  const cards = strip.locator('.filmstrip-card');
  assert.equal(await strip.isVisible(), false, 'first Down reveals the timeline');
  await page.keyboard.press('ArrowDown');
  assert.equal(await strip.isVisible(), true);
  assert.deepEqual(await cards.locator('.filmstrip-title').allTextContents(), titles.slice(0, 6));
  assert.equal(await cards.nth(1).locator('.filmstrip-status').textContent(), 'Previous');
  assert.equal(await cards.nth(3).locator('.filmstrip-status').textContent(), 'Up next');
  assert.equal(await strip.locator('[aria-current="true"].focused .filmstrip-title').textContent(), titles[2]);

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ptitle').textContent(), titles[1]);
  assert.equal(await strip.isVisible(), false);
  await page.keyboard.press('ArrowDown');
  for (let i = 1; i < 8; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await strip.locator('.focused .filmstrip-title').textContent(), titles[8]);
  await strip.locator('.focused').click();
  assert.equal(await page.locator('#ptitle').textContent(), titles[8]);
  await page.locator('#playerBack').click();
  assert.equal(await page.locator('#results .card.focused .ttl').textContent(), titles[2]);
});

test('History autoplay keeps its original order and skips an unavailable post', async t => {
  const { page, requests } = await fixture(t, { playable: true });
  await page.evaluate(() => localStorage.setItem('hellotv.history', JSON.stringify({
    't:zeta2': { title: 'Last video', watchedAt: 10 },
    't:alpha2': { title: 'Unavailable video', watchedAt: 20 },
    't:beta2': { title: 'First video', watchedAt: 30 }
  })));
  await page.route('**/2/status/alpha2', route => route.fulfill({
    status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}'
  }));
  await page.reload();
  await page.locator('[data-nav="history"]').click();
  await page.locator('#rows .card', { hasText: 'First video' }).click();
  const playing = id => page.waitForFunction(id => {
    const v = document.getElementById('video');
    return v.readyState >= 3 && !v.paused && v.currentSrc.includes('/' + id + '/');
  }, id);
  await playing('beta2');
  await page.locator('#video').evaluate(v => { v.currentTime = v.duration - 0.15; });
  await playing('zeta2');
  assert.ok(requests.some(url => url.endsWith('/2/status/zeta2')));
});

test('4K MP4 plays through its corrected HLS stream when the post has one', async t => {
  const { page, requests } = await fixture(t, { captions: true, uhdStream: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  assert.match(await page.locator('#video').getAttribute('src'), /1280x720/);
  await remote(page, 406);
  const variant = page.waitForRequest(request => request.url().includes('/video/2160.m3u8'));
  await page.locator('#qualityMenu .quality-option').getByText('2160p · 4K', { exact: true }).click();
  await variant;
  assert.match(await page.locator('#video').getAttribute('src'), /^blob:/);
  assert.ok(!requests.some(url => url.includes('3840x2160/clip.mp4')), 'the uncorrected 4K file is not played');
  assert.match(await page.locator('#qualityButton').innerText(), /2160p/);
});

test('vertical 4K MP4 finds its HLS variant by the short side', async t => {
  const { page, requests } = await fixture(t, { captions: true, uhdStream: 'vertical' });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await remote(page, 406);
  const variant = page.waitForRequest(request => request.url().includes('/video/2160.m3u8'));
  await page.locator('#qualityMenu .quality-option').getByText('2160p · 4K', { exact: true }).click();
  await variant;
  assert.ok(!requests.some(url => url.includes('3840x2160/clip.mp4')), 'the uncorrected 4K file is not played');
});

test('4K MP4 plays directly when its HLS stream has no 4K variant', async t => {
  const { page } = await fixture(t, { captions: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await remote(page, 406);
  await page.locator('#qualityMenu .quality-option').getByText('2160p · 4K', { exact: true }).click();
  await page.waitForFunction(() => /3840x2160/.test(document.getElementById('video').getAttribute('src') || ''));
  assert.match(await page.locator('#qualityButton').innerText(), /2160p/);
});

test('HLS quality selector keeps 4K variants while defaulting to a 1080p-or-lower stream', async t => {
  const { page, requests } = await fixture(t);
  await query(page);
  await page.locator('#results .badge.live').waitFor();
  await chip(page, 'Live');
  const initialSource = page.waitForResponse(response => response.url().includes('/720.m3u8'));
  await page.locator('#results .card').first().click();
  await initialSource;
  assert.ok(requests.some(url => url.includes('/720.m3u8')));
  assert.match(await page.locator('#video').getAttribute('src'), /^blob:/);
  await page.locator('#qualityButton').click();
  await page.locator('#qualityMenu .quality-option').getByText('2160p · 4K', { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('qualityButton').textContent.indexOf('2160p') !== -1);
  // The source returns 404. A failed quality must still allow switching down.
  await page.locator('#errLabel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#loadLabel').isVisible(), false);
  await page.locator('#video').evaluate(video => video.dispatchEvent(new Event('waiting')));
  assert.equal(await page.locator('#loadLabel').isVisible(), false, 'a late waiting event cannot overlap the final error');
  assert.ok(requests.some(url => url.includes('/2160.m3u8')));
  await page.locator('#qualityButton').click();
  const lowerSource = page.waitForRequest(request => request.url().includes('/360.m3u8'));
  await page.locator('#qualityMenu .quality-option').filter({ hasText: /^360p/ }).click();
  await lowerSource;
  assert.match(await page.locator('#qualityButton').innerText(), /360p/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#video').getAttribute('src'), null);
});

test('the Red key toggles centred Telemetry independently of the filmstrip and timeline', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  const hint = page.locator('.player-key-hint');
  assert.equal(await hint.isVisible(), true);
  assert.equal(await hint.innerText(), 'Telemetry');
  assert.equal(await hint.getByRole('img', { name: 'Red key' }).isVisible(), true);
  const play = await page.locator('#playButton').boundingBox();
  const post = await page.locator('#postButton').boundingBox();
  const hintBounds = await hint.boundingBox();
  assert.ok(play.x + play.width < hintBounds.x && hintBounds.x + hintBounds.width < post.x);
  await page.keyboard.press('ArrowDown');
  const hud = page.getByRole('region', { name: 'Telemetry' });
  assert.equal(await hud.isVisible(), false, 'Down only moves focus');
  await remote(page, 403);
  await hud.getByText('24 fps', { exact: true }).waitFor();
  assert.match(await hud.innerText(), /Buffer ahead[\s\S]*Decoded resolution[\s\S]*Frames \/ dropped/i);
  assert.match(await hud.innerText(), /Network\s+Online[\s\S]*Download speed[\s\S]*Video server/);
  assert.equal(await hud.getByRole('button').count(), 0);
  assert.equal(await page.evaluate(async () => (await document.fonts.load('700 26px "D-DIN"')).length), 1);
  await page.waitForFunction(() => {
    const panel = document.getElementById('statsPanel').getBoundingClientRect();
    const player = document.getElementById('player').getBoundingClientRect();
    return Math.abs(panel.left - player.left) < 1 &&
      Math.abs((panel.top + panel.bottom) / 2 - (player.top + player.bottom) / 2) < 1;
  });
  const hudBounds = await hud.boundingBox();
  const filmstrip = page.locator('#filmstrip');
  assert.ok((await filmstrip.boundingBox()).x > hudBounds.x + hudBounds.width);

  await remote(page, 403);
  assert.equal(await hud.isVisible(), false);
  assert.equal(await filmstrip.isVisible(), true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#chrome').getAttribute('class'), 'hide');
  await remote(page, 403);
  assert.equal(await hud.isVisible(), true);
  assert.equal(await page.locator('#chrome').getAttribute('class'), 'hide');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#playerBack.focused').count(), 1);
  await page.keyboard.press('ArrowUp');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 38, repeat: true, bubbles: true })));
  assert.equal(await page.locator('#chrome').getAttribute('class'), 'hide');
  assert.equal(await hud.isVisible(), true);
});

test('broadcast chat receives updates, escapes text, supports remote tabs and closes with the player', async t => {
  const { page, requests } = await fixture(t, { playable: true, broadcastChat: true });
  await query(page);
  await page.locator('#results .badge.live').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.waitForFunction(() => document.getElementById('broadcastAudience').textContent === 'LIVE · 123 watching');
  await remote(page, 405);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.locator('#postBody .post-text').filter({ hasText: '<b>literal chat</b>' }).waitFor();
  assert.equal(await page.locator('#postBody b').count(), 0);
  await page.locator('#postBody').getByText('New live message', { exact: true }).waitFor();
  assert.equal(await page.locator('#postBody .reply').count(), 2, 'polling does not duplicate the first message');
  assert.equal(await page.locator('#postChatTab.selected').count(), 1);
  await page.screenshot({ path: 'test-results/broadcast-chat-preview.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#postPanel.on').count(), 0);
  const before = requests.filter(url => url.includes('/chatapi/')).length;
  await page.waitForTimeout(3200);
  assert.equal(requests.filter(url => url.includes('/chatapi/')).length, before, 'hidden chat does not poll');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#broadcastAudience').innerText(), '');
});

test('replay chat does not display stale viewers and failed chat leaves video playing', async t => {
  const { page } = await fixture(t, { playable: true, replay: true, broadcastChat: true, chatFailure: true });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.waitForFunction(() => document.getElementById('broadcastAudience').textContent === 'Broadcast ended');
  await page.locator('#postButton').click();
  await page.locator('#postChatTab').click();
  await page.locator('#chatRetry').waitFor();
  assert.match(await page.locator('#postBody').innerText(), /Chat could not connect/);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), false);
  assert.equal(await page.locator('#errLabel').isVisible(), false);
  await page.locator('#postCommentsTab').click();
  await page.locator('#commentsMore').waitFor();
  await page.locator('#playerBack').click();
});

test('MP4 quality changes preserve decoded playback position and pause', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#video').evaluate(video => { video.pause(); video.currentTime = 8; });
  await page.locator('#qualityButton').click();
  await page.locator('#qualityMenu .quality-option').getByText('360p', { exact: true }).click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && v.currentTime >= 7.5 && v.paused; }, null, { timeout: 5000 }).catch(async () => {
    assert.fail(JSON.stringify(await page.locator('#video').evaluate(v => ({ time: v.currentTime, paused: v.paused, ready: v.readyState, duration: v.duration, error: v.error && v.error.code, src: v.src }))));
  });
  assert.equal(await page.locator('#video').evaluate(v => v.videoWidth), 640);
  assert.ok(Math.abs(await page.locator('#video').evaluate(v => v.currentTime) - 8) < 0.5);
});

test('HLS version 6 decodes through MSE and quality switches preserve pause and position', async t => {
  const { page } = await fixture(t, { playable: true, replay: true });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#video').evaluate(video => { video.pause(); video.currentTime = 8; });
  await remote(page, 403);
  assert.match(await page.locator('#statsPanel').innerText(), /640 × 360[\s\S]*HLS \(MSE\)/);
  await page.locator('#statsPanel').getByText('24 fps', { exact: true }).waitFor();
  await page.locator('#qualityButton').click();
  await page.locator('#qualityMenu .quality-option').getByText('360p', { exact: true }).click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && v.currentTime >= 7.5 && v.paused; });
  assert.equal(await page.locator('#video').evaluate(v => v.videoWidth), 640);
  assert.equal(await page.locator('#loadLabel').isVisible(), false, 'a buffered paused video is not still loading');
  await page.locator('#playerBack').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#video').getAttribute('src'), null);
});

test('closing a video saves its position and resumes after an app reload', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#video').evaluate(v => { v.pause(); v.currentTime = 8; });
  await page.waitForFunction(() => !document.getElementById('video').seeking);
  await page.locator('#playerBack').click();
  await page.keyboard.press('Escape');
  assert.match(await page.evaluate(() => localStorage.getItem('hellotv.positions')), /"time":8/);
  await page.reload();
  await page.locator('#rows .card').first().waitFor();
  await page.locator('[data-nav="search"]').click();
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && v.currentTime >= 7.5; });
});

test('timeline arrows scrub while paused and OK plays from the selected point', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => {
    const v = document.getElementById('video');
    return v.readyState >= 3 && !v.paused;
  });
  await page.locator('#video').evaluate(v => { v.currentTime = 3; });
  const playbackAt = (time, paused) => page.waitForFunction(({ time, paused }) => {
    const v = document.getElementById('video');
    return !v.seeking && v.paused === paused && Math.abs(v.currentTime - time) < 1;
  }, { time, paused });

  await page.keyboard.press('ArrowRight');
  await playbackAt(13, true);
  await page.keyboard.press('ArrowLeft');
  await playbackAt(3, true);
  await page.keyboard.press('ArrowRight');
  await playbackAt(13, true);
  await page.keyboard.press('Enter');
  await playbackAt(13, false);
  await remote(page, 412);
  await playbackAt(3, false);
});

test('cursor clicks seek on the timeline and continue playback', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#video').evaluate(v => v.pause());
  const timeline = await page.locator('#timeline').boundingBox();
  await page.mouse.click(timeline.x + timeline.width * 0.6, timeline.y + timeline.height / 2);
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.currentTime >= 11.5 && !v.paused; });
  assert.ok(await page.locator('#video').evaluate(v => v.currentTime) < 14);
});

test('thumbnail progress and History persist, refetch a post, and resume after restart', async t => {
  const { page, requests } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  const title = await page.locator('#results .card .ttl').first().innerText();
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  await page.locator('#video').evaluate(v => { v.pause(); v.currentTime = v.duration / 2; });
  await page.waitForFunction(() => !document.getElementById('video').seeking);
  await exitPlayer(page);
  const watchedCard = page.locator('#results .card').filter({ hasText: title });
  assert.match(await watchedCard.innerText(), /50% watched/);
  assert.equal(await watchedCard.locator('.watch-progress span').evaluate(el => parseFloat(el.style.width)), 50);
  await page.locator('[data-nav="history"]').click();
  assert.equal(await page.locator('#homeTitle').innerText(), 'History');
  assert.equal(await page.locator('#rows .card').count(), 1);
  await page.locator('#homeChips .home-chip[aria-label="In progress"]').click();
  assert.equal(await page.locator('#rows .card').count(), 1);
  await page.reload();
  await page.locator('[data-nav="history"]').click();
  await page.locator('#rows .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused && v.currentTime > 9; });
  assert.ok(requests.some(url => url.includes('/2/status/zeta2')));
  await exitPlayer(page);
  assert.equal(await page.locator('#homeTitle').innerText(), 'History');
  assert.equal(await page.locator('#rows .card').count(), 1, 'replays update rather than duplicate history');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#homeTitle').innerText(), 'Hot right now');
});

test('completed videos show a full thumbnail bar and Watched marker but restart at zero', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  await page.locator('#video').evaluate(v => { v.pause(); v.currentTime = v.duration - 0.5; });
  await page.waitForFunction(() => !document.getElementById('video').seeking);
  await exitPlayer(page);
  await page.locator('[data-nav="history"]').click();
  await page.locator('#homeChips .home-chip[aria-label="Watched"]').click();
  assert.equal(await page.locator('#rows .card').count(), 1);
  assert.match(await page.locator('#rows .card').innerText(), /Watched/);
  assert.equal(await page.locator('#rows .watch-progress span').evaluate(el => el.style.width), '100%');
  await page.locator('#rows .card').click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  assert.ok(await page.locator('#video').evaluate(v => v.currentTime) < 3);
});

test('unavailable historical posts stay in History with an error and never open a blank player', async t => {
  const { page } = await fixture(t, { playable: true, historyFailure: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  await exitPlayer(page);
  await page.locator('[data-nav="history"]').click();
  await page.locator('#rows .card').click();
  await page.getByText('This video is unavailable. It remains in History.', { exact: true }).waitFor();
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-browse');
  assert.equal(await page.locator('#rows .card').count(), 1);
});

test('Back dismisses the timeline and Telemetry separately and ignores a held key', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  await remote(page, 403);
  await page.locator('#postButton').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  assert.equal(await page.locator('#chrome').getAttribute('class'), 'hide');
  assert.equal(await page.locator('#postPanel.on, #qualityMenu.on, #captionsMenu.on').count(), 0);
  assert.equal(await page.locator('#statsPanel.on').count(), 1);
  await page.locator('#video').evaluate(v => v.dispatchEvent(new Event('playing')));
  assert.equal(await page.locator('#chrome').getAttribute('class'), 'hide', 'a buffering recovery cannot undo Back');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, repeat: true, bubbles: true })));
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  assert.equal(await page.locator('#video').evaluate(v => v.paused), false);
  await remote(page, 461);
  assert.equal(await page.locator('#statsPanel.on').count(), 0);
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  await remote(page, 461);
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
});

test('History starts empty and does not record a video that never played', async t => {
  const { page } = await fixture(t);
  await page.locator('[data-nav="history"]').click();
  assert.match(await page.locator('#rows').innerText(), /Your history is empty/);
  await page.locator('[data-nav="search"]').click();
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await exitPlayer(page);
  await page.locator('[data-nav="history"]').click();
  assert.equal(await page.locator('#rows .card').count(), 0);
  assert.match(await page.locator('#rows').innerText(), /Your history is empty/);
});

test('switching from History to Search cancels a pending video open', async t => {
  const { page } = await fixture(t, { playable: true, historyDelay: 400 });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused; });
  await exitPlayer(page);
  await page.locator('[data-nav="history"]').click();
  await page.locator('#rows .card').click();
  const response = page.waitForResponse(res => res.url().includes('/2/status/zeta2'));
  await page.locator('[data-nav="search"]').click();
  await response;
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
  assert.equal(await page.locator('#video').getAttribute('src'), null);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#homeTitle').innerText(), 'Hot right now');
});

test('saved History remains visible if the initial Home request fails', async t => {
  const { page } = await fixture(t, { homeFailure: true, storedHistory: true });
  await page.locator('[data-nav="history"]').click();
  await page.getByText("Couldn't load videos", { exact: true }).waitFor();
  assert.equal(await page.locator('#homeTitle').innerText(), 'History');
  assert.match(await page.locator('#rows .card').innerText(), /Saved video/);
  assert.match(await page.locator('#rows .card').innerText(), /50% watched/);
});

test('post text and paginated comments remain readable while video plays', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#postButton').click();
  assert.match(await page.locator('#postBody').innerText(), /video/);
  await page.locator('#postCommentsTab').click();
  await page.locator('#commentsMore').waitFor();
  assert.match(await page.locator('#postBody').innerText(), /Great launch!/);
  await page.waitForFunction(() => {
    var images = document.querySelectorAll('#postBody img.emoji');
    return images.length === 4 && Array.prototype.every.call(images, function (image) { return image.complete && image.naturalWidth > 0; });
  });
  assert.equal(await page.locator('#postBody img[alt="🪩"]').count(), 1);
  assert.equal(await page.locator('#postBody b').count(), 0, 'post text remains escaped');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('25px "TV Math"', '𝕍')), true);
  await page.locator('#commentsMore').click();
  await page.getByText('Second page reply', { exact: true }).waitFor();
  assert.equal(await page.locator('#postBody .reply').count(), 2);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), false);
  await page.locator('#postTextTab').click();
  assert.match(await page.locator('#postBody').innerText(), /Second paragraph kept in full/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  assert.equal(await page.locator('#postPanel.on').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
});

test('unavailable comments show an error with retry instead of an empty conversation', async t => {
  const { page } = await fixture(t, { playable: true, commentsFailure: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#postButton').click();
  await page.locator('#postCommentsTab').click();
  await page.getByText('Try again', { exact: true }).waitFor();
  assert.match(await page.locator('#postBody').innerText(), /could not load comments/);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), false);
});

test('player arrows move focus and colour keys provide shortcuts', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  assert.equal(await page.locator('#timeline.focused').count(), 1);
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#playerBack.focused').count(), 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#filmstrip .filmstrip-card.focused').count(), 1);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#playButton.focused').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true);
  assert.equal(await page.locator('#playButton').getAttribute('aria-label'), 'Play');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#captionsButton.focused').count(), 1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#qualityButton.focused').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#qualityMenu.on').count(), 1);
  const menu = await page.locator('#qualityMenu').boundingBox();
  const button = await page.locator('#qualityButton').boundingBox();
  assert.ok(menu.y + menu.height <= button.y && menu.x + menu.width > 1600, 'Quality opens upward at the bottom right');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#qualityMenu.on').count(), 0);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true);
  await remote(page, 404);
  assert.equal(await page.locator('#captionsMenu.on').count(), 1);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true);
  await remote(page, 404);
  assert.equal(await page.locator('#captionsMenu.on').count(), 0);
  await remote(page, 415);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), false);
  await remote(page, 405);
  assert.equal(await page.locator('#postPanel.on').count(), 1);
  await remote(page, 405);
  assert.equal(await page.locator('#postPanel.on').count(), 0);
  await remote(page, 405);
  assert.equal(await page.locator('#postPanel.on').count(), 1);
  await remote(page, 406);
  assert.equal(await page.locator('#postPanel.on').count(), 0);
  assert.equal(await page.locator('#qualityMenu.on').count(), 1);
  await remote(page, 406);
  assert.equal(await page.locator('#qualityMenu.on').count(), 0);
  await remote(page, 19);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true);
});

test('captions list X subtitle tracks, draw escaped cues, and are remembered for the next video', async t => {
  const { page } = await fixture(t, { playable: true, captions: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  assert.equal(await page.locator('#captionsButton').getAttribute('aria-pressed'), 'false', 'captions start off');
  await page.locator('#captionsButton').click();
  const english = page.locator('#captionsMenu .quality-option').filter({ hasText: 'English (auto-generated)' });
  await english.waitFor();
  await english.click();
  assert.equal(await page.locator('#captionsMenu.on').count(), 0);
  await page.locator('#video').evaluate(v => { v.pause(); v.currentTime = 2; });
  await page.waitForFunction(() => document.getElementById('captions').textContent === 'Hello <b>captions</b> & more');
  assert.equal(await page.locator('#captions b').count(), 0, 'caption text is escaped');
  assert.equal(await page.locator('#captionsButton').getAttribute('aria-pressed'), 'true');
  await page.locator('#video').evaluate(v => { v.currentTime = 5.5; });
  await page.waitForFunction(() => document.getElementById('captions').textContent === '');
  await page.locator('#playerBack').click();
  await page.locator('#results .card').nth(1).click();
  await page.waitForFunction(() => document.getElementById('captionsButton').getAttribute('aria-pressed') === 'true');
  await page.locator('#captionsButton').click();
  await page.locator('#captionsMenu .quality-option').getByText('Off', { exact: true }).click();
  assert.equal(await page.locator('#captions').textContent(), '');
  await page.locator('#playerBack').click();
  await page.locator('#results .card').nth(2).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#captionsButton').getAttribute('aria-pressed'), 'false', 'Off is remembered too');
});

test('videos without caption tracks say so instead of showing an empty menu', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.locator('#captionsButton').click();
  assert.match(await page.locator('#captionsMenu').innerText(), /This video has no captions/);
  assert.equal(await page.locator('#captionsButton.unavailable').count(), 1);
});

test('nothing around the video is animated, faded or layered, so the TV video plane stays visible', async t => {
  const { page } = await fixture(t, { playable: true });
  await query(page);
  await chip(page, 'Videos');
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  const offenders = await page.evaluate(() => {
    const found = [];
    for (let el = document.getElementById('video'); el && el !== document.documentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.animationName !== 'none' || Number(style.opacity) < 1 || style.filter !== 'none' ||
        (style.webkitMaskImage && style.webkitMaskImage !== 'none') || /transform|opacity/.test(style.willChange) ||
        (el !== document.body && style.transform !== 'none')) found.push(el.id || el.tagName);
    }
    return found;
  });
  assert.deepEqual(offenders, []);
  assert.equal(await page.locator('#stage').evaluate(el => getComputedStyle(el).visibility), 'hidden');
  assert.equal(await page.locator('#searchView').evaluate(el => getComputedStyle(el).visibility), 'hidden');
  await page.locator('#playerBack').click();
  assert.equal(await page.locator('#searchView').evaluate(el => getComputedStyle(el).visibility), 'visible');
});

test('failed MP4 automatically falls back to a lower quality and keeps the resume position', async t => {
  const { page, requests } = await fixture(t, { playable: true, failHighQuality: true });
  await query(page);
  await chip(page, 'Videos');
  await page.evaluate(() => HelloFavourites.savePosition('t:zeta2', 8, 20));
  await page.locator('#results .card').first().click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused && v.currentTime >= 7.5; });
  assert.match(await page.locator('#video').getAttribute('src'), /640x360/);
  assert.equal(await page.locator('#errLabel').isVisible(), false);
  assert.ok(!requests.some(url => url.includes('3840x2160/clip.mp4')), 'fallback does not try a higher resolution');
});

test('failed HLS automatically plays a lower available quality', async t => {
  const { page, requests } = await fixture(t, { playable: true, replay: true, failHighQuality: true });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused && document.getElementById('qualityButton').textContent.includes('360p'); });
  assert.ok(requests.some(url => url.includes('/360.m3u8')));
  assert.equal(await page.locator('#errLabel').isVisible(), false);
});

test('expired HLS links refresh automatically and preserve the saved position', async t => {
  const { page, requests } = await fixture(t, { playable: true, replay: true, expiredLink: true });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.evaluate(() => HelloFavourites.savePosition('b:TestCast', 8, 20));
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused && v.currentTime >= 7.5; });
  assert.ok(requests.filter(url => url.startsWith('https://x.com/')).length >= 2);
  assert.equal(await page.locator('#errLabel').isVisible(), false);
});

test('HLS replays resume after closing and reloading the app', async t => {
  const { page } = await fixture(t, { playable: true, replay: true });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.locator('#video').evaluate(v => { v.pause(); v.currentTime = 8; });
  await page.waitForFunction(() => !document.getElementById('video').seeking);
  await page.locator('#playerBack').click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('#rows .card').first().waitFor();
  await page.locator('[data-nav="search"]').click();
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && !v.paused && v.currentTime >= 7.5; });
});

test('Back cancels a pending playback recovery without reopening the video', async t => {
  const { page } = await fixture(t, { replay: true, recoveryDelay: 2200 });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.getByText('Refreshing broadcast...', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-player');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
  assert.equal(await page.locator('#video').getAttribute('src'), null);
});

test('mid-play buffering shows live download speed against stream bitrate and clears on resume or exit', async t => {
  const { page } = await fixture(t, { playable: true, replay: true });
  page.setDefaultTimeout(10000);
  await page.evaluate(() => {
    const trigger = Hls.prototype.trigger;
    Hls.prototype.trigger = function (event, data) {
      if (event === Hls.Events.FRAG_LOADED && data.frag.type === 'main') window.bufferTestFrag = data.frag;
      return trigger.apply(this, arguments);
    };
  });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => document.getElementById('video').currentTime > 0.1 && window.bufferTestFrag);
  // Freeze playback so native waiting/canplay events cannot race the simulated stall.
  await page.evaluate(() => new Promise(resolve => {
    const video = document.getElementById('video');
    if (video.paused) return resolve();
    video.addEventListener('pause', resolve, { once: true });
    video.pause();
  }));
  await page.locator('#video').evaluate(v => v.dispatchEvent(new Event('playing')));
  assert.equal(await page.locator('#bufferingDetails').isVisible(), false);
  await page.evaluate(() => {
    const video = document.getElementById('video');
    const stats = bufferTestFrag.stats;
    stats.loading.start = performance.now() - 10000; stats.loading.end = 0;
    stats.loaded = stats.total = 125000;
    video.dispatchEvent(new Event('waiting'));
  });
  await page.locator('#bufferingDetails').waitFor({ state: 'visible' });
  assert.match(await page.locator('#bufferingRates').textContent(), /Download 0\.1 Mbps · Stream bitrate 0\.5 Mbps/);
  assert.equal(await page.locator('#bufferingReason').textContent(), 'Download is below the stream bitrate');
  await page.evaluate(() => { bufferTestFrag.stats.loading.end = performance.now(); });
  await page.waitForFunction(() => document.getElementById('bufferingRates').textContent.includes('(last segment)'));
  await page.screenshot({ path: 'test-results/buffering-rates-preview.png' });
  await page.locator('#video').evaluate(v => v.dispatchEvent(new Event('playing')));
  assert.equal(await page.locator('#bufferingDetails').isVisible(), false);
  await page.locator('#video').evaluate(v => v.dispatchEvent(new Event('waiting')));
  assert.equal(await page.locator('#bufferingDetails').isVisible(), true);
  await page.locator('#playerBack').click();
  assert.equal(await page.locator('#bufferingDetails').isVisible(), false);
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#bufferingDetails').evaluate(el => el.style.display), 'none', 'the refresh timer stays stopped');
});

test('HLS quality changes keep the existing stream playing while the new playlist loads', async t => {
  const { page } = await fixture(t, { playable: true, replay: true, slowQuality: 1300 });
  await query(page);
  await page.locator('#results .badge.replay').waitFor();
  await page.locator('#results .card').filter({ hasText: 'Live launch' }).click();
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  const source = await page.locator('#video').getAttribute('src');
  const before = await page.locator('#video').evaluate(v => v.currentTime);
  await page.locator('#qualityButton').click();
  const requested = page.waitForRequest(request => request.url().includes('/2160.m3u8'));
  await page.locator('#qualityMenu .quality-option').getByText('2160p · 4K', { exact: true }).click();
  await requested;
  assert.match(await page.locator('#qualityButton').innerText(), /720p.*2160p.*loading/);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#video').getAttribute('src'), source, 'same decoder and MediaSource');
  assert.ok(await page.locator('#video').evaluate(v => v.currentTime) > before + 0.5);
  assert.equal(await page.locator('#loadLabel').isVisible(), false);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), false);
});

test('Home shows the focused video artwork behind the header and anchors the focused row', async t => {
  const { page } = await fixture(t);
  await page.locator('[data-nav="home"]').click();
  await page.locator('#homeChips .home-chip[aria-label="Videos"]').click();
  await page.waitForFunction(() => /icon\.png/.test(document.querySelector('#backdrop .bd.on')?.style.backgroundImage || ''));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const second = await page.evaluate(() => {
    const card = document.querySelector('#rows .card.focused');
    const rows = document.getElementById('rows');
    let top = 0;
    for (let el = card; el && el !== rows; el = el.offsetParent) top += el.offsetTop;
    return { index: Array.from(document.querySelectorAll('#rows .card')).indexOf(card), top,
      scroll: rows.scrollTop, max: rows.scrollHeight - rows.clientHeight };
  });
  assert.equal(second.index, 4);
  assert.ok(second.max > 0);
  assert.equal(second.scroll, Math.min(second.top - 28, second.max), 'remote focus moves the focused row toward the top');
  const ring = await page.evaluate(() => {
    const ring = document.querySelector('#rows .focus-ring');
    const thumb = document.querySelector('#rows .card.focused .thumb');
    return { on: ring.className, transform: ring.style.transform, width: ring.offsetWidth, thumbWidth: thumb.offsetWidth };
  });
  assert.equal(ring.on, 'focus-ring on', 'the focus ring follows remote focus');
  assert.match(ring.transform, /^translate\(/);
  assert.ok(Math.abs(ring.width - ring.thumbWidth) <= 1, 'the ring matches the thumbnail');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#rows .focus-ring').getAttribute('class'), 'focus-ring', 'the ring hides when focus leaves the grid');
});

test('Settings turn animations and artwork off, survive a reload, and close with Back', async t => {
  const { page } = await fixture(t);
  assert.equal(await page.evaluate(() => document.documentElement.className), 'motion artwork');
  await page.locator('[data-nav="settings"]').click();
  assert.equal(await page.locator('#settings.on').count(), 1);
  assert.equal(await page.locator('#settingsList .setting.focused .setting-name').innerText(), 'Animations');
  await page.keyboard.type('n');
  assert.equal(await page.locator('#query .ghost').count(), 1, 'typing does not reach Search behind Settings');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#settingsList .setting').first().getAttribute('aria-checked'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.className.trim()), 'artwork');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#backdrop').evaluate(el => getComputedStyle(el).display), 'none');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings.on').count(), 0);
  assert.equal(await page.locator('#app').getAttribute('class'), 'screen-search');
  assert.equal(await page.locator('#nav .focused').getAttribute('data-nav'), 'settings');
  await page.reload();
  await page.locator('#rows .card').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.className.trim()), '');
  assert.equal(await page.locator('#rows .grid.enter').count(), 0, 'no entrance animation when animations are off');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#rows .grid').evaluate(el => el.style.transform), '', 'rows scroll without animation');
});

test('the expanded sidebar shows the footer and enlarges and inverts the focused coffee QR', async t => {
  const { page } = await fixture(t);
  assert.equal(await page.title(), 'Clicker');
  const coffee = page.getByRole('button', { name: 'Buy me a coffee' });
  const settings = page.locator('[data-nav="settings"]');
  const qr = coffee.locator('img');
  const tip = page.getByRole('tooltip');
  const footer = page.locator('.app-version');
  assert.equal(await coffee.isVisible(), false);
  assert.equal(await footer.isVisible(), false);
  await settings.hover();
  assert.ok((await coffee.boundingBox()).y < (await settings.boundingBox()).y);
  assert.equal(await qr.getAttribute('src'), 'white-qr-transparent.svg');
  await page.waitForFunction(() => document.querySelector('.coffee-code img').naturalWidth > 0);
  assert.equal(await footer.isVisible(), true);
  const disclaimer = footer.locator('.app-source');
  assert.equal(await disclaimer.textContent(), 'Public content from x.com');
  const versionBounds = await footer.locator('.build-label').boundingBox();
  assert.ok((await disclaimer.boundingBox()).x > versionBounds.x + versionBounds.width);
  assert.ok((await footer.boundingBox()).height <= 22, 'version and disclaimer fit on one line');
  assert.equal(await tip.isVisible(), false);
  assert.equal(await qr.evaluate(img => getComputedStyle(img).filter), 'none');
  const search = page.locator('#searchView');
  assert.equal(await search.evaluate(el => getComputedStyle(el).filter), 'none');
  assert.match(await search.evaluate(el => getComputedStyle(el).transitionProperty), /filter/);
  assert.match(await settings.evaluate(el => getComputedStyle(el).transitionProperty), /filter/);
  const compactWidth = (await qr.boundingBox()).width;
  await coffee.hover();
  await tip.waitFor();
  await page.waitForFunction(width => document.querySelector('.coffee-code img').getBoundingClientRect().width >= width * 1.77, compactWidth);
  assert.equal(await qr.evaluate(img => getComputedStyle(img).filter), 'invert(1)');
  assert.equal(await qr.evaluate(img => getComputedStyle(img.parentElement).backgroundColor), 'rgb(255, 255, 255)');
  assert.match(await tip.innerText(), /a coffee helps support its development[\s\S]*Stripe checkout/);
  await page.waitForFunction(() => {
    const filter = selector => getComputedStyle(document.querySelector(selector)).filter;
    return filter('#searchView') === 'blur(8px) brightness(0.62)' &&
      filter('[data-nav="settings"]') === 'blur(4px) brightness(0.62)' &&
      filter('.app-version') === 'blur(4px) brightness(0.62)';
  });
  assert.equal(await coffee.evaluate(el => getComputedStyle(el).filter), 'none');
  assert.equal(await tip.evaluate(el => getComputedStyle(el).filter), 'none');
  const buttonBounds = await coffee.boundingBox();
  const codeBounds = await coffee.locator('.coffee-code').boundingBox();
  const labelBounds = await coffee.locator('.lbl').boundingBox();
  assert.ok(buttonBounds.y <= codeBounds.y && codeBounds.y + codeBounds.height <= labelBounds.y);
  assert.ok(buttonBounds.y + buttonBounds.height < (await settings.boundingBox()).y);
  assert.ok((await tip.boundingBox()).x > buttonBounds.x + buttonBounds.width);
  await page.mouse.move(40, 740);
  assert.equal(await tip.isVisible(), false);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('searchView')).filter === 'none' &&
    getComputedStyle(document.querySelector('[data-nav="settings"]')).filter === 'none');
  await settings.click();
  assert.match(await page.locator('.settings-about').innerText(), /^Clicker /);
  assert.equal(await page.locator('#settings').getByText('Buy me a coffee').count(), 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');
  assert.match(await coffee.getAttribute('class'), /focused/);
  assert.equal(await tip.isVisible(), true);
  assert.equal(await qr.evaluate(img => getComputedStyle(img).filter), 'invert(1)');
  await page.evaluate(() => { window.open = url => { window.openedCheckout = url; }; });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.openedCheckout), await page.evaluate(() => HELLO_TV.coffeeUrl));
  await page.keyboard.press('ArrowDown');
  assert.equal(await tip.isVisible(), false);
  await page.keyboard.press('ArrowRight');
  assert.equal(await coffee.isVisible(), false);
  assert.equal(await footer.isVisible(), false);
  await page.locator('[data-nav="home"]').click();
  await settings.hover();
  await coffee.hover();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('stage')).filter === 'blur(8px) brightness(0.62)');
});

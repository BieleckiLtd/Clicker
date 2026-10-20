const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function catalog(handles, respond) {
  const requests = [];
  const local = {};
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function (method, url) { this.url = url; };
  XMLHttpRequest.prototype.send = function () {
    requests.push(this.url);
    setImmediate(() => {
      const result = respond(new URL(this.url));
      if (!result) { this.onerror(); return; }
      this.status = result.status || 200;
      this.responseText = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      this.readyState = 4;
      this.onreadystatechange();
    });
  };
  const context = { XMLHttpRequest, setTimeout, Date,
    localStorage: { getItem: key => local[key] || null, setItem: (key, value) => { local[key] = value; } },
    HELLO_TV: { accounts: handles } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/catalog.js'), 'utf8'), context);
  return { api: context.HelloCatalog, requests };
}

function broadcast(handle, id, timestamp) {
  return { type: 'status', id: 'post-' + id, text: 'Launch https://x.com/i/broadcasts/' + id,
    created_timestamp: timestamp, author: { screen_name: handle } };
}

function metadata(id, live) {
  return '<meta property="og:video:url" content="https://prod.pscp.tv/' + id + '/master.m3u8?type=' + (live ? 'live' : 'replay') + '">' +
    '<meta name="twitter:string:broadcast_state" content="' + (live ? 'RUNNING' : 'ENDED') + '">';
}

test('blocked X requests use video detection in the fallback and classify live/replay', async () => {
  const { api, requests } = catalog(['NASASpaceflight'], url => {
    if (url.hostname === 'x.com') return null;
    if (url.hostname === 'api.microlink.io') {
      const id = new URL(url.searchParams.get('url')).pathname.split('/').pop();
      const data = { description: id };
      if (url.searchParams.get('video') === 'true') data.video = {
        url: 'https://prod.pscp.tv/' + id + '/master.m3u8?type=' + (id === 'LiveCast' ? 'live' : 'replay')
      };
      return { body: { status: 'success', data } };
    }
    return { body: '#EXTM3U\n' };
  });
  for (const id of ['LiveCast', 'ReplayCast']) {
    const item = { broadcastId: id };
    await new Promise((resolve, reject) => api.resolve(item, error => error ? reject(error) : resolve()));
    assert.equal(item.live, id === 'LiveCast');
    assert.equal(item.replay, id === 'ReplayCast');
    assert.equal(item.pending, false);
    assert.match(item.playback.url, /master\.m3u8/);
  }
  assert.equal(requests.filter(url => url.includes('api.microlink.io')).length, 2);
});

test('each saved channel gets automatic broadcast checks beyond four newer broadcasts', async () => {
  const { api, requests } = catalog(['SpaceX', 'NASASpaceflight'], url => {
    if (url.hostname === 'api.fxtwitter.com') {
      const handle = url.pathname.split('/')[3];
      const results = handle === 'SpaceX' ? Array.from({ length: 5 }, (_, n) => broadcast(handle, 'Replay' + n, 200 - n)) :
        [broadcast(handle, 'NsfLive', 100)];
      return { body: { results } };
    }
    if (url.hostname === 'x.com') {
      const id = url.pathname.split('/').pop();
      return { body: metadata(id, id === 'NsfLive') };
    }
    return { body: '#EXTM3U\n' };
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('NASASpaceflight was never checked for a live stream')), 500);
    api.load(false, error => { if (error) { clearTimeout(timeout); reject(error); } }, data => {
      if (data.rows.some(row => row.id === 'live' && row.items.some(item => item.broadcastId === 'NsfLive'))) {
        clearTimeout(timeout);
        resolve(data);
      }
    });
  });
  assert.equal(result.rows.find(row => row.id === 'nasaspaceflight').items[0].live, true);
  assert.ok(requests.includes('https://x.com/i/broadcasts/NsfLive'));
  assert.equal(requests.filter(url => url.startsWith('https://x.com/')).length, 5, 'at most four automatic checks per channel');
});

test('portrait videos are named by their short side, play up to 1080p, and keep their caption playlist', async () => {
  const formats = ['480x852', '720x1280', '1080x1920'].map(size => ({
    url: 'https://video.twimg.com/amplify_video/9/vid/avc1/' + size + '/clip.mp4', container: 'mp4', bitrate: Number(size.split('x')[0]) * 1000 }));
  formats.unshift({ url: 'https://video.twimg.com/amplify_video/9/pl/master.m3u8?tag=29', container: 'm3u8' });
  const { api } = catalog(['SpaceX'], url => url.hostname === 'api.fxtwitter.com' ? { body: { results: [{
    type: 'status', id: '9', text: 'Vertical launch', created_timestamp: 100, author: { screen_name: 'SpaceX' },
    media: { videos: [{ duration: 20, thumbnail_url: 'https://pbs.twimg.com/9.jpg', formats }] } }] } } : { body: '' });
  const data = await new Promise((resolve, reject) => api.load(false, (error, result) => error ? reject(error) : resolve(result)));
  const clip = data.rows.find(row => row.id === 'spacex').items[0];
  assert.match(clip.playback.url, /1080x1920/);
  assert.deepEqual(Array.from(clip.qualities, quality => quality.label), ['1080p', '720p', '480p']);
  assert.equal(clip.captionSource, 'https://video.twimg.com/amplify_video/9/pl/master.m3u8?tag=29');
});

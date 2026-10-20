const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/favourites.js'), 'utf8');
const key = 'hellotv.favourites';
const list = handle => [{ handle, name: handle }];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function launch(database, local = {}, options = {}) {
  const context = { setTimeout, clearTimeout, localStorage: {
    getItem: name => local[name] || null,
    setItem: (name, value) => { local[name] = value; }
  } };
  context.window = context;
  context.PalmServiceBridge = function () {
    this.call = (uri, text) => {
      const method = uri.split('/').pop(), data = JSON.parse(text);
      setTimeout(() => {
        let response = { returnValue: true };
        if (method === 'find') response.results = database.record ? [database.record] : [];
        if (method === 'put') {
          if (options.failWrite) response = { returnValue: false, errorText: 'storage full' };
          else {
            const object = data.objects[0];
            if (database.record) assert.equal(object._rev, database.record._rev, 'writes use the current revision');
            database.record = { ...object, _id: 'favourites', _rev: (database.record?._rev || 0) + 1 };
            response.results = [{ id: 'favourites', rev: database.record._rev }];
          }
        }
        this.onservicecallback(JSON.stringify(response));
      }, options.delay || 2);
    };
  };
  vm.runInNewContext(source, context);
  return { api: context.HelloFavourites, local, ready: new Promise(resolve => context.HelloFavourites.ready(resolve)) };
}

test('personal Groq credentials survive TV updates without appearing in settings or History', async () => {
  const database = {}, app = launch(database);
  await app.ready;
  const key = 'gsk_' + 'unit-test'.repeat(6);
  assert.equal(app.api.setSecret('groq', key), true);
  await delay(15);
  assert.equal(JSON.stringify(app.api.settings()).includes(key), false);
  assert.equal(JSON.stringify(app.api.history()).includes(key), false);
  const updated = launch(database);
  await updated.ready;
  assert.equal(updated.api.secret('groq'), key);
  updated.api.setSecret('groq', '');
  await delay(15);
  const disconnected = launch(database);
  await disconnected.ready;
  assert.equal(disconnected.api.secret('groq'), '');
});

test('TV favourites migrate from localStorage into DB8', async () => {
  const database = {};
  const app = launch(database, { [key]: JSON.stringify(list('blueorigin')) });
  await app.ready;
  await delay(15);
  assert.deepEqual(database.record.favourites, list('blueorigin'));
});

test('TV favourites restore after an update clears browser storage', async () => {
  const database = { record: { _id: 'favourites', _rev: 1, favourites: list('blueorigin') } };
  const app = launch(database);
  await app.ready;
  assert.equal(JSON.stringify(app.api.get()), JSON.stringify(list('blueorigin')));
  assert.deepEqual(JSON.parse(app.local[key]), list('blueorigin'));
  const reopened = launch(database);
  await reopened.ready;
  assert.equal(JSON.stringify(reopened.api.get()), JSON.stringify(list('blueorigin')));
});

test('rapid favourite changes serialize DB8 writes without losing the latest list', async () => {
  const database = { record: { _id: 'favourites', _rev: 1, favourites: list('nasa') } };
  const app = launch(database, {}, { delay: 5 });
  await app.ready;
  app.api.set(list('blueorigin'));
  app.api.set(list('spacex'));
  await delay(30);
  assert.deepEqual(database.record.favourites, list('spacex'));
  assert.equal(database.record._rev, 3);
});

test('a late DB8 read does not overwrite a channel chosen during startup', async () => {
  const database = { record: { _id: 'favourites', _rev: 1, favourites: list('nasa') } };
  const app = launch(database, {}, { delay: 5 });
  app.api.set(list('blueorigin'));
  await app.ready;
  await delay(15);
  assert.deepEqual(database.record.favourites, list('blueorigin'));
});

test('DB8 write failures notify the UI and keep the local fallback', async () => {
  const app = launch({}, {}, { failWrite: true });
  await app.ready;
  let failures = 0;
  app.api.onError = () => { failures++; };
  app.api.set(list('blueorigin'));
  await delay(15);
  assert.equal(failures, 1);
  assert.deepEqual(JSON.parse(app.local[key]), list('blueorigin'));
});

test('playback positions persist through DB8 even without a custom favourite list', async () => {
  const database = {};
  const app = launch(database);
  await app.ready;
  app.api.savePosition('t:video', 12, 90);
  await delay(15);
  assert.equal(database.record.positions['t:video'].time, 12);
  const updated = launch(database);
  await updated.ready;
  assert.equal(updated.api.position('t:video'), 12);
  updated.api.savePosition('t:video', 89, 90);
  await delay(15);
  assert.equal(database.record.positions['t:video'].time, 0);
});

test('history metadata and completed progress survive updates without storing stream URLs', async () => {
  const database = {};
  const app = launch(database);
  await app.ready;
  app.api.remember({ id: 't:123', postId: '123', title: 'Launch', thumbnail: 'https://pbs.twimg.com/launch.jpg',
    playback: { url: 'https://video.twimg.com/expired.mp4' }, qualities: [{ url: 'expired' }] }, true);
  app.api.savePosition('t:123', 45, 90);
  await delay(15);
  const updated = launch(database);
  await updated.ready;
  assert.equal(updated.api.history()[0].title, 'Launch');
  assert.equal(updated.api.progress('t:123').fraction, 0.5);
  assert.ok(!JSON.stringify(database.record.history).includes('expired'));
  updated.api.savePosition('t:123', 89, 90);
  await delay(15);
  const again = launch(database);
  await again.ready;
  assert.equal(again.api.position('t:123'), 0, 'completed videos restart');
  assert.equal(again.api.progress('t:123').fraction, 1, 'completion remains visible');
  assert.equal(again.api.progress('t:123').completed, true);
  again.api.savePosition('t:short', 0, 2);
  assert.equal(again.api.progress('t:short').completed, false, 'starting a short clip is not completion');
});

test('history includes legacy positions, keeps over 80 entries, and ignores unplayed catalogue items', async () => {
  const app = launch({});
  await app.ready;
  app.api.remember({ id: 't:unplayed', title: 'Never played' }, false);
  for (let n = 0; n < 85; n++) app.api.savePosition('t:' + n, 10, 90);
  assert.equal(app.api.history().length, 85);
  app.api.remember({ id: 't:0', title: 'Recovered title' }, false);
  assert.equal(app.api.history().find(item => item.id === 't:0').title, 'Recovered title');
  await delay(30);
});

test('late DB8 history reads merge older entries without losing playback started during startup', async () => {
  const database = { record: { _id: 'favourites', _rev: 1, history: {
    't:1': { id: 't:1', title: 'Old title', watchedAt: 1 }, 'b:cast': { id: 'b:cast', title: 'Past broadcast', watchedAt: 2 }
  } } };
  const app = launch(database, {}, { delay: 5 });
  app.api.remember({ id: 't:1', title: 'New title' }, true);
  await app.ready;
  await delay(15);
  assert.equal(app.api.history().length, 2);
  assert.equal(app.api.history()[0].title, 'New title');
  assert.equal(database.record.history['t:1'].title, 'New title');
});

test('display settings survive a package update that clears browser storage', async () => {
  const database = {};
  const app = launch(database);
  await app.ready;
  app.api.setSetting('motion', false);
  app.api.setSetting('artwork', false);
  await delay(15);
  assert.equal(database.record.settings.motion, false);
  const updated = launch(database, {});
  assert.equal(Object.keys(updated.api.settings()).length, 0, 'nothing local before TV storage answers');
  await updated.ready;
  assert.equal(updated.api.settings().motion, false);
  assert.equal(updated.api.settings().artwork, false);
  updated.api.setSetting('motion', true);
  await delay(15);
  const again = launch(database, { 'hellotv.settings': JSON.stringify({ motion: false, at: 1 }) });
  await again.ready;
  assert.equal(again.api.settings().motion, true, 'the newer stored choice wins over a stale local copy');
});

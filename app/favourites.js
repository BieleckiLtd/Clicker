// ES5. DB8 retains TV favourites across package updates; browsers use localStorage.
(function () {
  var KEY = 'hellotv.favourites';
  var POSITION_KEY = 'hellotv.positions';
  var HISTORY_KEY = 'hellotv.history';
  var SETTINGS_KEY = 'hellotv.settings';
  var KIND = 'com.example.hellotv.favourites:1';
  var cache = null;
  var record = null;
  var ready = false;
  var dbReady = false;
  var changed = false;
  var positions = {};
  var history = {};
  var settings = {};
  var busy = false;
  var queued = false;
  var waiters = [];
  var requests = [];
  var api = { onError: null };
  try { cache = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  try { positions = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}') || {}; } catch (e2) {}
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; } catch (e3) {}
  try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e4) {}
  if (typeof positions !== 'object' || Array.isArray(positions)) positions = {};
  if (typeof history !== 'object' || Array.isArray(history)) history = {};
  if (typeof settings !== 'object' || Array.isArray(settings)) settings = {};

  function valid(list) { return list && typeof list.length === 'number' && list.length > 0; }
  if (!valid(cache)) cache = null;

  function mirror() {
    try {
      if (cache) localStorage.setItem(KEY, JSON.stringify(cache));
      localStorage.setItem(POSITION_KEY, JSON.stringify(positions));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    }
    catch (e) { return false; }
  }

  function report() { if (api.onError) api.onError(); }

  function call(method, parameters, cb) {
    var bridge;
    var done = false;
    var timer;
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      var index = requests.indexOf(bridge);
      if (index !== -1) requests.splice(index, 1);
      cb(error, result);
    }
    try {
      bridge = new PalmServiceBridge();
      requests.push(bridge);
      bridge.onservicecallback = function (text) {
        var result;
        try { result = JSON.parse(text); } catch (e) { return finish(e); }
        finish(result.returnValue ? null : new Error(result.errorText || 'TV storage unavailable'), result);
      };
      timer = setTimeout(function () { finish(new Error('TV storage timeout')); }, 4000);
      bridge.call('luna://com.palm.db/' + method, JSON.stringify(parameters));
    } catch (e) { finish(e); }
  }

  function flush() {
    if (!dbReady || busy || !queued) return;
    queued = false;
    busy = true;
    var object = { _kind: KIND, favourites: cache, positions: positions, history: history, settings: settings };
    if (record) { object._id = record.id; object._rev = record.rev; }
    call('put', { objects: [object] }, function (error, result) {
      busy = false;
      if (error) report();
      else if (result.results && result.results.length) record = result.results[0];
      flush();
    });
  }

  function finishInit() {
    ready = true;
    var batch = waiters;
    waiters = [];
    for (var i = 0; i < batch.length; i++) batch[i]();
    flush();
  }

  api.get = function () { return cache; };
  api.ready = function (cb) { if (ready) cb(); else waiters.push(cb); };
  api.set = function (list) {
    cache = list;
    changed = true;
    queued = true;
    var localSaved = mirror();
    if (ready && !dbReady && (typeof PalmServiceBridge === 'function' || !localSaved)) report();
    flush();
  };
  api.position = function (id) {
    var saved = positions[id];
    return saved && typeof saved.time === 'number' && isFinite(saved.time) ? saved.time : 0;
  };
  api.progress = function (id) {
    var saved = positions[id];
    if (!saved || !isFinite(saved.duration) || saved.duration <= 0) return null;
    return { time: saved.time || 0, duration: saved.duration, completed: !!saved.completed,
      fraction: saved.completed ? 1 : Math.max(0, Math.min(1, (saved.time || 0) / saved.duration)) };
  };
  api.history = function () {
    var out = [];
    var seen = {};
    function add(id, item) {
      if (seen[id] || !/^[tb]:[A-Za-z0-9_-]+$/.test(id)) return;
      seen[id] = true;
      var entry = {};
      for (var field in item) if (item.hasOwnProperty(field)) entry[field] = item[field];
      entry.id = id;
      entry.watchedAt = entry.watchedAt || (positions[id] && positions[id].at) || 0;
      if (!entry.title) entry.title = id.indexOf('b:') === 0 ? 'Broadcast' : 'Video';
      if (id.indexOf('b:') === 0) entry.broadcastId = id.slice(2);
      else if (!entry.postId) entry.postId = id.slice(2);
      out.push(entry);
    }
    for (var id in history) if (history.hasOwnProperty(id) && history[id]) add(id, history[id]);
    for (var key in positions) if (positions.hasOwnProperty(key) && positions[key]) add(key, {});
    out.sort(function (a, b) { return b.watchedAt - a.watchedAt; });
    return out;
  };
  api.remember = function (item, played) {
    if (!item || !item.id || (!played && !history[item.id] && !positions[item.id])) return;
    var old = history[item.id];
    var entry = { id: item.id, watchedAt: played ? Date.now() : (old && old.watchedAt) || (positions[item.id] && positions[item.id].at) || 0 };
    var fields = ['title', 'thumbnail', 'postId', 'postText', 'postUrl', 'replyCount', 'authorName', 'authorHandle',
      'authorAvatar', 'publishedAt', 'views', 'durationSec', 'broadcastId', 'live', 'replay'];
    for (var i = 0; i < fields.length; i++) if (item[fields[i]] !== undefined) entry[fields[i]] = item[fields[i]];
    if (JSON.stringify(old) === JSON.stringify(entry)) return;
    history[item.id] = entry;
    queued = true;
    if (!mirror() && ready && !dbReady) report();
    flush();
  };
  api.settings = function () {
    var copy = {};
    for (var name in settings) if (settings.hasOwnProperty(name)) copy[name] = settings[name];
    return copy;
  };
  api.setSetting = function (name, value) {
    settings[name] = value;
    settings.at = Date.now();
    queued = true;
    if (!mirror() && ready && !dbReady) report();
    flush();
  };
  api.savePosition = function (id, time, duration) {
    if (!id || !isFinite(time) || !isFinite(duration) || duration <= 0) return;
    var completed = time > 0 && duration - time < Math.min(3, duration * 0.05);
    positions[id] = { time: completed ? 0 : Math.max(0, time), duration: duration, completed: completed, at: Date.now() };
    queued = true;
    mirror();
    flush();
  };
  window.HelloFavourites = api;

  if (typeof PalmServiceBridge !== 'function') { finishInit(); return; }
  // The kind remains app-owned; no permissions are granted to other apps or cloud sync.
  call('putKind', { id: KIND, owner: 'com.example.hellotv', private: false, indexes: [] }, function (error) {
    if (error) return finishInit();
    call('find', { query: { from: KIND, limit: 1 } }, function (findError, result) {
      if (findError) return finishInit();
      dbReady = true;
      var saved = result.results && result.results[0];
      if (saved) {
        record = { id: saved._id, rev: saved._rev };
        if (!changed && valid(saved.favourites)) cache = saved.favourites;
        var remote = saved.positions || {};
        for (var id in remote) {
          if (!remote.hasOwnProperty(id) || !remote[id] || typeof remote[id].time !== 'number') continue;
          if (!positions[id] || (remote[id].at || 0) > (positions[id].at || 0)) positions[id] = remote[id];
          else if ((positions[id].at || 0) > (remote[id].at || 0)) queued = true;
        }
        for (var localId in positions) if (positions.hasOwnProperty(localId) && !remote[localId]) queued = true;
        var remoteHistory = saved.history || {};
        for (var historyId in remoteHistory) {
          if (!remoteHistory.hasOwnProperty(historyId) || !remoteHistory[historyId]) continue;
          if (!history[historyId] || (remoteHistory[historyId].watchedAt || 0) > (history[historyId].watchedAt || 0)) history[historyId] = remoteHistory[historyId];
          else if ((history[historyId].watchedAt || 0) > (remoteHistory[historyId].watchedAt || 0)) queued = true;
        }
        for (var localHistoryId in history) if (history.hasOwnProperty(localHistoryId) && !remoteHistory[localHistoryId]) queued = true;
        var remoteSettings = saved.settings;
        if (remoteSettings && typeof remoteSettings === 'object' && (remoteSettings.at || 0) > (settings.at || 0)) settings = remoteSettings;
        else if ((settings.at || 0) > ((remoteSettings && remoteSettings.at) || 0)) queued = true;
        mirror();
      } else if (cache || Object.keys(positions).length || Object.keys(history).length || settings.at) queued = true;
      finishInit();
    });
  });
})();

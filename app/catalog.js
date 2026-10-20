// Plain ES5. The TV loads public timelines itself. No PC server.
(function () {
  var HOME_TTL = 45000;
  var LIVE_TTL = 20000;
  var REPLAY_MEM_TTL = 600000;
  var STORE_TTL = 7200000;
  var STORE_KEY = 'hellotv.broadcasts.v3';
  var BACKGROUND_LIMIT = 4; // Per saved channel, so one busy channel cannot hide another's live stream.

  var generation = 0;
  var loadWaiters = null;
  var updateFn = null;
  var model = null;
  var castCache = {};
  var neg = {};
  var inflight = {};

  var FAV_KEY = 'hellotv.favourites';
  var FAV_LIMIT = 10;

  function accounts() {
    var list = window.HELLO_TV && window.HELLO_TV.accounts;
    if (list && list.length) return list.slice();
    return ['SpaceX', 'NASA', 'NASAKennedy', 'Space_Station'];
  }

  function defaultFavourites() {
    var list = accounts();
    var out = [];
    for (var i = 0; i < list.length; i++) out.push({ handle: list[i], name: list[i], avatar: '' });
    return out;
  }

  function favourites() {
    if (window.HelloFavourites) {
      var saved = HelloFavourites.get();
      return saved && saved.length ? saved : defaultFavourites();
    }
    try {
      var raw = localStorage.getItem(FAV_KEY);
      if (raw) {
        var list = JSON.parse(raw);
        if (list && typeof list.length === 'number' && list.length) return list;
      }
    } catch (e) {}
    return defaultFavourites();
  }

  function writeFavourites(list) {
    if (window.HelloFavourites) { HelloFavourites.set(list); return; }
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); }
    catch (e2) {}
  }

  function favouriteHandles() {
    var list = favourites();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].handle) out.push(list[i].handle);
    }
    return out.length ? out : accounts();
  }

  function isFavourite(handle) {
    return !!favouriteByHandle(handle);
  }

  function favouriteByHandle(handle) {
    var want = String(handle || '').toLowerCase();
    var list = favourites();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].handle || '').toLowerCase() === want) return list[i];
    }
    return null;
  }

  function toggleFavourite(profile) {
    var handle = profile && profile.handle;
    if (!handle) return 'full';
    var list = favourites();
    var want = String(handle).toLowerCase();
    var next = [];
    var removed = false;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].handle || '').toLowerCase() === want) removed = true;
      else next.push(list[i]);
    }
    if (removed) {
      if (!next.length) return 'last';
      writeFavourites(next);
      return 'removed';
    }
    if (next.length >= FAV_LIMIT) return 'full';
    next.push({
      handle: handle,
      name: profile.name || handle,
      avatar: profile.avatar || ''
    });
    writeFavourites(next);
    return 'added';
  }

  function cleanQuery(query) {
    return String(query || '').replace(/^\s+|\s+$/g, '').replace(/^@+/, '');
  }

  function findProfiles(query, cb) {
    var q = cleanQuery(query);
    if (q.length < 2) return cb(null, []);
    var url = 'https://api.fxtwitter.com/2/typeahead?q=' + encodeURIComponent(q) + '&result_type=users';
    httpGet(url, 12000, function (err, status, text) {
      var data = parseJson(text);
      if (err || status !== 200 || !data || !data.users) {
        return cb(err || new Error('Channel search unavailable (HTTP ' + status + ')'), []);
      }
      var users = (data && data.users) || [];
      var out = [];
      var seen = {};
      for (var i = 0; i < users.length && out.length < 8; i++) {
        var user = users[i];
        if (!user || !user.screen_name) continue;
        var key = String(user.screen_name).toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        out.push({
          handle: user.screen_name,
          name: user.name || user.screen_name,
          avatar: user.avatar_url || ''
        });
      }
      cb(out.length ? null : err, out);
    });
  }

  // X only serves post search to logged-in sessions, so keyword search of all
  // of X is impossible without an account. Instead we find matching channels
  // (typeahead, no login) and aggregate their recent videos and live streams.
  var SEARCH_CHANNELS = 6;

  function searchSort(a, b) {
    var aLive = a.live ? 1 : 0;
    var bLive = b.live ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return (b.publishedAt || 0) - (a.publishedAt || 0);
  }

  function collectSearch(profiles, groups, completed, total) {
    var items = [];
    var seen = {};
    var errors = [];
    for (var i = 0; i < groups.length; i++) {
      if (!groups[i]) continue;
      if (groups[i].error) errors.push(groups[i].error);
      var list = groups[i].items || [];
      for (var j = 0; j < list.length; j++) {
        if (seen[list[j].id]) continue;
        seen[list[j].id] = true;
        items.push(list[j]);
      }
    }
    items.sort(searchSort);
    return { profiles: profiles, items: items, errors: errors, completed: completed, total: total };
  }

  function search(query, cb, onProgress) {
    var q = cleanQuery(query);
    if (q.length < 2) return cb(null, { profiles: [], items: [] });
    findProfiles(q, function (err, profiles) {
      profiles = profiles || [];
      if (!profiles.length) return cb(err, { profiles: [], items: [] });
      var top = profiles.slice(0, SEARCH_CHANNELS);
      var groups = new Array(top.length);
      var completed = 0;
      if (onProgress) onProgress(collectSearch(profiles, groups, 0, top.length));
      for (var n = 0; n < top.length; n++) {
        (function (profile, index) {
          fetchStatuses(profile.handle, function (e, statuses) {
            groups[index] = e || !statuses ? { error: profile.handle + ': ' + (e ? e.message : 'unavailable') } :
              itemsFromStatuses(statuses, profile.handle);
            completed += 1;
            var data = collectSearch(profiles, groups, completed, top.length);
            if (completed === top.length) cb(data.errors.length === top.length ? new Error('Channels unavailable') : null, data);
            else if (onProgress) onProgress(data);
          });
        })(top[n], n);
      }
    });
  }

  function httpGet(url, timeout, cb) {
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(err, status, text) {
      if (done) return;
      done = true;
      cb(err, status || 0, text || '');
    }
    try {
      xhr.open('GET', url, true);
    } catch (e) {
      finish(e, 0, '');
      return;
    }
    xhr.timeout = timeout || 20000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 0) return finish(new Error('network'), 0, '');
      finish(null, xhr.status, xhr.responseText || '');
    };
    xhr.onerror = function () { finish(new Error('network'), 0, ''); };
    xhr.ontimeout = function () { finish(new Error('timeout'), 0, ''); };
    try { xhr.send(); }
    catch (sendErr) { finish(sendErr, 0, ''); }
  }

  function parseJson(text) {
    try { return JSON.parse(text); }
    catch (e) { return null; }
  }

  function decodeEntities(value) {
    return String(value || '')
      .replace(/&#x([0-9a-fA-F]+);/g, function (all, hex) {
        var code = parseInt(hex, 16);
        if (!code || code > 65535) return all;
        return String.fromCharCode(code);
      })
      .replace(/&#(\d+);/g, function (all, num) {
        var code = parseInt(num, 10);
        if (!code || code > 65535) return all;
        return String.fromCharCode(code);
      })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function metaContent(html, key) {
    var escKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var patterns = [
      new RegExp('content="([^"]*)"[^>]*?(?:property|name)="' + escKey + '"', 'i'),
      new RegExp('(?:property|name)="' + escKey + '"[^>]*?content="([^"]*)"', 'i')
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = patterns[i].exec(html);
      if (match && (match[1] || match[2])) return decodeEntities(match[1] || match[2]);
    }
    return '';
  }

  function cleanTitle(text) {
    if (!text) return '';
    var t = String(text).replace(/https?:\/\/\S+/g, ' ').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (t.length > 160) t = t.substring(0, 157) + '...';
    return t;
  }

  function goodPlaylist(url) {
    if (!url || url.indexOf('https://') !== 0) return false;
    return url.indexOf('.m3u8') !== -1 || url.indexOf('pscp.tv') !== -1;
  }

  function usableThumb(url) {
    if (!url || url.indexOf('https://') !== 0) return '';
    return url;
  }

  function absolutize(uri, masterUrl) {
    if (/^https?:\/\//i.test(uri)) return uri;
    var origin = /^(https?:\/\/[^\/]+)/.exec(masterUrl);
    var root = origin ? origin[1] : '';
    if (uri.charAt(0) === '/') return root + uri;
    var slash = masterUrl.lastIndexOf('/');
    return masterUrl.substring(0, slash + 1) + uri;
  }

  function playlistQualities(text, masterUrl) {
    if (!text || text.indexOf('#EXTM3U') === -1) return [];
    var lines = text.split(/\r?\n/);
    var qualities = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
      var uri = '';
      for (var j = i + 1; j < lines.length; j++) {
        if (!lines[j] || lines[j].charAt(0) === '#') continue;
        uri = lines[j].replace(/^\s+|\s+$/g, '');
        break;
      }
      if (!uri) continue;
      var resolution = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      var height = resolution ? parseInt(resolution[2], 10) : 0;
      if (!height || height > 2160) continue;
      var bandwidth = /BANDWIDTH=(\d+)/.exec(line);
      var bw = bandwidth ? parseInt(bandwidth[1], 10) : 0;
      var codecs = /CODECS="([^"]+)"/.exec(line);
      var url = absolutize(uri, masterUrl);
      if (url.indexOf('https://') !== 0) continue;
      if (!qualities[height] || bw > qualities[height].bitrate) qualities[height] = {
        height: height, bitrate: bw, codec: codecs ? codecs[1] : '', url: url, type: 'hls', label: height === 2160 ? '2160p · 4K' : height + 'p'
      };
    }
    var out = [];
    for (var key in qualities) if (qualities.hasOwnProperty(key)) out.push(qualities[key]);
    out.sort(function (a, b) { return b.height - a.height; });
    return out;
  }

  function choosePlaylist(masterUrl, cb) {
    if (!goodPlaylist(masterUrl)) return cb('');
    httpGet(masterUrl, 5000, function (err, status, text) {
      var qualities = (!err && status === 200) ? playlistQualities(text, masterUrl) : [];
      var chosen = qualities.length ? qualities[qualities.length - 1] : null;
      for (var i = 0; i < qualities.length; i++) {
        if (qualities[i].height <= 1080) { chosen = qualities[i]; break; }
      }
      cb(chosen ? chosen.url : masterUrl, qualities);
    });
  }

  function viewsFrom(html) {
    if (metaContent(html, 'twitter:label2') !== 'Views') return null;
    var raw = metaContent(html, 'twitter:data2').replace(/,/g, '');
    var n = parseInt(raw, 10);
    return isFinite(n) ? n : null;
  }

  function infoFromHtml(id, html) {
    var url = metaContent(html, 'og:video:url') || metaContent(html, 'og:video:secure_url');
    if (!goodPlaylist(url)) return null;
    var stateName = metaContent(html, 'twitter:string:broadcast_state').toUpperCase();
    var live = false;
    if (stateName === 'RUNNING' || stateName === 'LIVE' || /[?&]type=live(?:&|$)/.test(url)) live = true;
    if (stateName === 'ENDED' || /[?&]type=replay(?:&|$)/.test(url)) live = false;
    var start = parseInt(metaContent(html, 'twitter:string:broadcast_start_time'), 10) || 0;
    var end = parseInt(metaContent(html, 'twitter:string:broadcast_end_time'), 10) || 0;
    return {
      id: id,
      url: url,
      live: live,
      title: metaContent(html, 'twitter:text:broadcast_title') || metaContent(html, 'og:description') || '',
      thumbnail: usableThumb(metaContent(html, 'twitter:image:broadcast_thumbnail:src')) ||
        usableThumb(metaContent(html, 'og:image:secure_url')) || usableThumb(metaContent(html, 'og:image')) ||
        usableThumb(metaContent(html, 'twitter:image')),
      durationSec: end > start ? Math.round((end - start) / 1000) : null,
      views: viewsFrom(html)
    };
  }

  function infoFromMicrolink(id, json) {
    if (!json || json.status !== 'success' || !json.data) return null;
    var data = json.data;
    var video = data.video || {};
    var url = video.url || '';
    if (!goodPlaylist(url)) return null;
    var thumb = data.image && data.image.url;
    return {
      id: id,
      url: url,
      live: /[?&]type=live(?:&|$)/.test(url),
      title: data.description || '',
      thumbnail: usableThumb(thumb),
      durationSec: null,
      views: null
    };
  }

  function fetchBroadcast(id, cb) {
    var pageUrl = 'https://x.com/i/broadcasts/' + id;
    httpGet(pageUrl, 8000, function (err, status, html) {
      var info = (!err && status === 200) ? infoFromHtml(id, html) : null;
      if (info) return finishPlaylist(info, cb);
      var micro = 'https://api.microlink.io/?url=' + encodeURIComponent(pageUrl) + '&video=true';
      httpGet(micro, 15000, function (err2, status2, body) {
        info = (!err2 && status2 === 200) ? infoFromMicrolink(id, parseJson(body)) : null;
        if (!info) return cb(err2 || new Error('no playlist'));
        finishPlaylist(info, cb);
      });
    });
  }

  function finishPlaylist(info, cb) {
    info.masterUrl = info.url;
    choosePlaylist(info.url, function (url, qualities) {
      if (!goodPlaylist(url)) return cb(new Error('no playlist'));
      info.url = url;
      info.qualities = qualities || [];
      info.at = Date.now();
      cb(null, info);
    });
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function writeStore(map) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); }
    catch (e) {}
  }

  function readStored(id) {
    var map = readStore();
    var info = map[id];
    if (!info || info.live || !info.url || !info.at) return null;
    if ((Date.now() - info.at) > STORE_TTL) {
      delete map[id];
      writeStore(map);
      return null;
    }
    return info;
  }

  function infoFresh(info) {
    if (!info || !info.url || !info.at) return false;
    var ttl = info.live ? LIVE_TTL : REPLAY_MEM_TTL;
    return (Date.now() - info.at) < ttl;
  }

  function cachedInfo(id) {
    var hit = castCache[id];
    if (hit && infoFresh(hit)) return hit;
    var stored = readStored(id);
    if (stored) {
      castCache[id] = stored;
      return stored;
    }
    if (hit && !hit.live) delete castCache[id];
    return null;
  }

  function saveInfo(info) {
    info.at = info.at || Date.now();
    castCache[info.id] = info;
    delete neg[info.id];
    if (info.live) return;
    var map = readStore();
    map[info.id] = {
      id: info.id,
      url: info.url,
      masterUrl: info.masterUrl || '',
      live: false,
      title: info.title || '',
      thumbnail: info.thumbnail || '',
      durationSec: info.durationSec || null,
      views: info.views || null,
      qualities: info.qualities || [],
      at: info.at
    };
    var keys = [];
    for (var key in map) if (map.hasOwnProperty(key)) keys.push(key);
    if (keys.length > 40) {
      keys.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
      for (var i = 0; i < keys.length - 40; i++) delete map[keys[i]];
    }
    writeStore(map);
  }

  function forget(id) {
    delete castCache[id];
    delete neg[id];
    var map = readStore();
    if (map[id]) {
      delete map[id];
      writeStore(map);
    }
  }

  function heightOf(format) {
    if (format.height) return format.height;
    var match = /\/(\d+)x(\d+)\//.exec(format.url || '');
    return match ? Math.min(parseInt(match[1], 10), parseInt(match[2], 10)) : 0;
  }

  function pickMp4(video) {
    var formats = (video && video.formats) || [];
    var best = null;
    var smallest = null;
    for (var i = 0; i < formats.length; i++) {
      var format = formats[i];
      if (!format.url || format.url.indexOf('.mp4') === -1) continue;
      var h = heightOf(format);
      if (!smallest || (h && h < smallest.h)) smallest = { url: format.url, h: h || 99999 };
      if (h > 1080) continue;
      var score = h * 100000 + (format.bitrate || 0);
      if (!best || score > best.score) best = { url: format.url, score: score };
    }
    if (best) return best.url;
    return smallest ? smallest.url : null;
  }

  function broadcastIdFrom(status) {
    if (!status) return null;
    var cast = status.media && status.media.broadcast;
    if (cast) {
      var fromCast = /broadcasts\/([A-Za-z0-9]+)/.exec(cast.url || '');
      if (fromCast) return fromCast[1];
      if (cast.id && /^[A-Za-z0-9]+$/.test(String(cast.id))) return String(cast.id);
    }
    var facets = (status.raw_text && status.raw_text.facets) || [];
    for (var i = 0; i < facets.length; i++) {
      var blob = (facets[i].replacement || '') + ' ' + (facets[i].original || '');
      var match = /broadcasts\/([A-Za-z0-9]+)/.exec(blob);
      if (match) return match[1];
    }
    var fromText = /broadcasts\/([A-Za-z0-9]+)/.exec(status.text || '');
    return fromText ? fromText[1] : null;
  }

  function broadcastIdFromStatus(status) {
    return broadcastIdFrom(status) || broadcastIdFrom(status && status.quote);
  }

  function baseItem(status) {
    var author = status.author || {};
    return {
      postId: String(status.id || ''),
      postText: status.text || '',
      postUrl: status.url || '',
      replyCount: typeof status.replies === 'number' ? status.replies : null,
      authorName: author.name || author.screen_name || '',
      authorHandle: author.screen_name || '',
      authorAvatar: author.avatar_url || '',
      publishedAt: (status.created_timestamp || 0) * 1000,
      views: status.views || null
    };
  }

  function videoItem(status) {
    var videos = status.media && status.media.videos;
    if (!videos || !videos.length) return null;
    var video = videos[0];
    var mp4 = pickMp4(video);
    var playlist = null;
    var formats = video.formats || [];
    for (var i = 0; i < formats.length; i++) {
      if (formats[i].url && formats[i].url.indexOf('.m3u8') !== -1) {
        playlist = formats[i].url;
        break;
      }
    }
    var hls = mp4 ? null : playlist;
    if (!mp4 && !hls) return null;
    var item = baseItem(status);
    item.id = 't:' + status.id;
    item.title = cleanTitle(status.text) || 'Video';
    item.thumbnail = video.thumbnail_url || '';
    // The HLS master lists any WebVTT captions, even when the MP4 is what plays.
    item.captionSource = playlist || '';
    item.durationSec = video.duration ? Math.round(video.duration) : null;
    item.live = false;
    item.replay = false;
    item.qualities = [];
    var sizes = {};
    for (var q = 0; q < formats.length; q++) {
      var format = formats[q];
      if (!format.url || format.url.indexOf('.mp4') === -1) continue;
      var height = heightOf(format);
      if (height > 2160) continue;
      if (!sizes[height] || (format.bitrate || 0) > sizes[height].bitrate) sizes[height] = {
        url: format.url, type: 'mp4', height: height, bitrate: format.bitrate || 0, codec: format.codecs || format.codec || '',
        label: height === 2160 ? '2160p · 4K' : (height ? height + 'p' : 'Source')
      };
    }
    for (var size in sizes) if (sizes.hasOwnProperty(size)) item.qualities.push(sizes[size]);
    item.qualities.sort(function (a, b) { return b.height - a.height; });
    item.playback = mp4
      ? { type: 'mp4', url: mp4 }
      : { type: 'hls', url: hls };
    return item;
  }

  function pendingBroadcast(status, bid) {
    var item = baseItem(status);
    item.id = 'b:' + bid;
    item.broadcastId = bid;
    item.title = cleanTitle(status.text) || 'Broadcast';
    item.thumbnail = '';
    item.durationSec = null;
    item.views = item.views || null;
    item.live = false;
    item.replay = false;
    item.pending = true;
    item.failed = false;
    item.playback = null;
    var info = cachedInfo(bid);
    if (info) applyInfo(item, info);
    return item;
  }

  function applyInfo(item, info) {
    var title = cleanTitle(info.title);
    if (title) item.title = title;
    if (info.thumbnail) item.thumbnail = info.thumbnail;
    if (info.durationSec) item.durationSec = info.durationSec;
    if (info.views) item.views = info.views;
    item.live = !!info.live;
    item.replay = !info.live;
    item.pending = false;
    item.failed = false;
    item.playback = { type: 'hls', url: info.url };
    item.masterUrl = info.masterUrl || '';
    item.qualities = info.qualities || [];
  }

  function accountProfile(statuses, handle) {
    var want = String(handle || '').toLowerCase();
    for (var i = 0; i < statuses.length; i++) {
      var author = statuses[i] && statuses[i].author;
      if (!author || !author.screen_name) continue;
      if (String(author.screen_name).toLowerCase() !== want) continue;
      return { name: author.name || handle, avatar: author.avatar_url || '' };
    }
    return { name: handle, avatar: '' };
  }

  function itemsFromStatuses(statuses, handle) {
    var videos = [];
    var seenVideo = {};
    var seen = {};
    var profile = accountProfile(statuses, handle);
    var fav = favouriteByHandle(handle);
    if (fav) {
      if (profile.name === handle && fav.name) profile.name = fav.name;
      if (!profile.avatar && fav.avatar) profile.avatar = fav.avatar;
    }
    var items = [];
    for (var i = 0; i < statuses.length; i++) {
      var status = statuses[i];
      if (!status || (status.type && status.type !== 'status')) continue;
      var clip = videoItem(status);
      if (!clip && status.quote && status.quote.id) clip = videoItem(status.quote);
      if (clip && !seenVideo[clip.id]) {
        seenVideo[clip.id] = true;
        videos.push(clip);
      }
      var bid = broadcastIdFromStatus(status);
      if (bid && !seen[bid]) {
        seen[bid] = true;
        items.push(pendingBroadcast(status, bid));
      }
    }
    for (var v = 0; v < videos.length; v++) items.push(videos[v]);
    items.sort(byTime);
    return {
      handle: handle,
      name: profile.name,
      avatar: profile.avatar,
      items: items,
      error: ''
    };
  }

  function fetchList(handle, kind, cb) {
    var all = [];
    function page(cursor, n, attempt) {
      var target = 'https://api.fxtwitter.com/2/profile/' + encodeURIComponent(handle) + '/' + kind;
      if (cursor) target += '?cursor=' + encodeURIComponent(cursor);
      httpGet(target, 20000, function (err, status, text) {
        var data = parseJson(text);
        var results = data && data.results;
        if (results && results.length) {
          for (var i = 0; i < results.length; i++) all.push(results[i]);
          var next = data.cursor && data.cursor.bottom;
          if (next && n < 1) return page(next, n + 1, 0);
          return cb(null, all);
        }
        if (all.length) return cb(null, all);
        if (!err && status === 200 && results && typeof results.length === 'number') return cb(null, all);
        if (attempt < 1) return setTimeout(function () { page(cursor, n, attempt + 1); }, 800);
        var message = (data && data.message) || (err ? err.message : ('HTTP ' + status));
        cb(new Error(message));
      });
    }
    page(null, 0, 0);
  }

  function fetchStatuses(handle, cb) {
    fetchList(handle, 'statuses', function (err, list) {
      if (!err && list && list.length) return cb(null, list);
      fetchList(handle, 'media', function (err2, media) {
        if (!err2 && media && media.length) return cb(null, media);
        cb(err || err2 || null, media || list || []);
      });
    });
  }

  function parallel(fns, done) {
    var left = fns.length;
    var results = new Array(fns.length);
    if (!left) return done(null, results);
    for (var i = 0; i < fns.length; i++) {
      (function (index) {
        fns[index](function (err, value) {
          results[index] = value;
          left -= 1;
          if (!left) done(null, results);
        });
      })(i);
    }
  }

  function byTime(a, b) {
    return (b.publishedAt || 0) - (a.publishedAt || 0);
  }

  function assemble(groups) {
    var accountRows = [];
    var all = [];
    var live = [];
    var seen = {};
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (!group) continue;
      var groupItems = group.items || [];
      for (var j = 0; j < groupItems.length; j++) {
        var item = groupItems[j];
        if (seen[item.id]) continue;
        seen[item.id] = true;
        all.push(item);
        if (item.live) live.push(item);
      }
      accountRows.push({
        id: String(group.handle || '').toLowerCase(),
        title: group.name || group.handle,
        avatar: group.avatar || '',
        items: groupItems.slice(0, 18),
        note: group.error || ''
      });
    }
    all.sort(byTime);
    live.sort(byTime);
    var featured = null;
    for (var k = 0; k < all.length; k++) {
      if (all[k].live) { featured = all[k]; break; }
    }
    if (!featured) {
      for (var n = 0; n < all.length; n++) {
        if (all[n].replay && !all[n].failed) { featured = all[n]; break; }
      }
    }
    if (!featured) {
      for (var p = 0; p < all.length; p++) {
        if (!all[p].failed) { featured = all[p]; break; }
      }
    }
    var rows = [];
    if (featured) rows.push({ id: 'featured', title: '', hero: true, items: [featured] });
    if (live.length) rows.push({ id: 'live', title: 'Live now', items: live });
    if (all.length) rows.push({ id: 'latest', title: 'Latest', items: all.slice(0, 18) });
    return {
      rows: rows.concat(accountRows),
      errors: (model && model.errors) ? model.errors.slice() : [],
      fetchedAt: model ? model.at : Date.now()
    };
  }

  function snapshot() {
    return assemble(model.groups);
  }

  function buildModel(myGen, done) {
    var handles = favouriteHandles();
    parallel(handles.map(function (handle) {
      return function (finish) {
        fetchStatuses(handle, function (err, statuses) {
          if (myGen !== generation) return finish(null, null);
          if (err) {
            var fav = favouriteByHandle(handle);
            return finish(null, {
              handle: handle,
              name: (fav && fav.name) || handle,
              avatar: (fav && fav.avatar) || '',
              items: [],
              error: err.message
            });
          }
          finish(null, itemsFromStatuses(statuses, handle));
        });
      };
    }), function (err, groups) {
      if (myGen !== generation) return done();
      var clean = [];
      var errors = [];
      var any = false;
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i];
        if (!group) continue;
        if (group.error) errors.push(group.handle + ': ' + group.error);
        if (group.items && group.items.length) any = true;
        clean.push(group);
      }
      if (!any) return done(new Error(errors.length ? errors[0] : 'No videos'));
      model = { groups: clean, errors: errors, at: Date.now() };
      done(null);
    });
  }

  function itemsWithBroadcast(id) {
    var out = [];
    if (!model) return out;
    for (var i = 0; i < model.groups.length; i++) {
      var items = model.groups[i].items || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].broadcastId === id) out.push(items[j]);
      }
    }
    return out;
  }

  function markFailed(id) {
    neg[id] = Date.now();
    var items = itemsWithBroadcast(id);
    for (var i = 0; i < items.length; i++) {
      items[i].pending = false;
      items[i].failed = true;
      items[i].replay = false;
      items[i].live = false;
    }
  }

  function lookup(id, force, cb) {
    var hit = cachedInfo(id);
    if (hit) {
      var ready = itemsWithBroadcast(id);
      for (var i = 0; i < ready.length; i++) applyInfo(ready[i], hit);
      return cb(null, hit);
    }
    if (neg[id]) {
      var age = Date.now() - neg[id];
      if (!force && age < 120000) return cb(new Error('unavailable'));
      if (force && age < 15000) return cb(new Error('unavailable'));
    }
    if (inflight[id]) {
      inflight[id].push(cb);
      return;
    }
    inflight[id] = [cb];
    fetchBroadcast(id, function (err, info) {
      var waiters = inflight[id] || [];
      delete inflight[id];
      if (info && info.url) {
        saveInfo(info);
        var items = itemsWithBroadcast(id);
        for (var n = 0; n < items.length; n++) applyInfo(items[n], info);
      } else {
        markFailed(id);
      }
      for (var w = 0; w < waiters.length; w++) {
        waiters[w](info ? null : (err || new Error('unavailable')), info || null);
      }
    });
  }

  function pendingIds() {
    var list = [];
    var seen = {};
    if (!model) return list;
    for (var i = 0; i < model.groups.length; i++) {
      var items = model.groups[i].items || [];
      var selected = 0;
      for (var j = 0; j < items.length && selected < BACKGROUND_LIMIT; j++) {
        var item = items[j];
        if (!item.broadcastId || seen[item.broadcastId]) continue;
        if (item.playback && item.playback.url) continue;
        if (item.failed) continue;
        if (neg[item.broadcastId] && (Date.now() - neg[item.broadcastId]) < 120000) continue;
        seen[item.broadcastId] = true;
        list.push(item);
        selected += 1;
      }
    }
    list.sort(byTime);
    var ids = [];
    for (var k = 0; k < list.length; k++) ids.push(list[k].broadcastId);
    return ids;
  }

  function pool(list, limit, each, done) {
    var index = 0;
    var active = 0;
    function pump() {
      if (index >= list.length && active === 0) return done();
      while (active < limit && index < list.length) {
        var item = list[index];
        index += 1;
        active += 1;
        each(item, function () {
          active -= 1;
          pump();
        });
      }
    }
    if (!list.length) done();
    else pump();
  }

  function publish() {
    if (updateFn && model) updateFn(snapshot());
  }

  function kickResolve() {
    pool(pendingIds(), 2, function (id, next) {
      lookup(id, false, function () {
        publish();
        next();
      });
    }, function () {});
  }

  function load(force, cb, onUpdate) {
    if (typeof onUpdate === 'function') updateFn = onUpdate;
    if (!force && model && (Date.now() - model.at) < HOME_TTL) {
      cb(null, snapshot());
      kickResolve();
      return;
    }
    if (loadWaiters) {
      loadWaiters.push(cb);
      if (!force) return;
    } else {
      loadWaiters = [cb];
    }
    var myGen = ++generation;
    buildModel(myGen, function (err) {
      if (myGen !== generation) return;
      var batch = loadWaiters || [];
      loadWaiters = null;
      var data = (!err && model) ? snapshot() : null;
      for (var i = 0; i < batch.length; i++) {
        batch[i](data ? null : (err || new Error('No videos')), data);
      }
      if (data) kickResolve();
    });
  }

  function resolve(item, cb) {
    if (!item) return cb(new Error('no item'));
    if (item.playback && item.playback.url) return cb(null, item);
    if (!item.broadcastId) return cb(new Error('no broadcast'));
    lookup(item.broadcastId, true, function (err, info) {
      if (info) applyInfo(item, info);
      cb(err, item);
    });
  }

  window.HelloCatalog = {
    load: load,
    resolve: resolve,
    forget: forget,
    search: search,
    restore: function (saved, cb) {
      // History stores stable post/broadcast IDs, never expiring stream URLs.
      if (saved.broadcastId) {
        var cast = {};
        for (var key in saved) if (saved.hasOwnProperty(key)) cast[key] = saved[key];
        cast.playback = null;
        return resolve(cast, function (error) { cb(error, error ? null : cast); });
      }
      if (!saved.postId) return cb(new Error('Post unavailable'));
      httpGet('https://api.fxtwitter.com/2/status/' + encodeURIComponent(saved.postId), 12000, function (error, status, text) {
        var data = parseJson(text);
        var item = !error && status === 200 && data && data.code === 200 && data.status ? videoItem(data.status) : null;
        cb(item ? null : (error || new Error('Video unavailable')), item);
      });
    },
    conversation: function (id, cursor, cb) {
      var url = 'https://api.fxtwitter.com/2/conversation/' + encodeURIComponent(id);
      if (cursor) url += '?cursor=' + encodeURIComponent(cursor);
      httpGet(url, 12000, function (error, status, text) {
        var data = parseJson(text);
        if (error || status !== 200 || !data || !data.replies || typeof data.replies.length !== 'number') return cb(error || new Error('Comments unavailable'));
        cb(null, data);
      });
    },
    isFavourite: isFavourite,
    toggleFavourite: toggleFavourite
  };
})();

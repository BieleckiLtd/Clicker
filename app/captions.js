// ES5. Public WebVTT captions listed in a video's HLS master playlist (X adds
// auto-generated subtitles to some uploads). No login; files are plain public GETs.
(function () {
  var NAMES = {
    ar: 'Arabic', de: 'German', en: 'English', es: 'Spanish', fr: 'French', hi: 'Hindi', it: 'Italian',
    ja: 'Japanese', ko: 'Korean', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese', ru: 'Russian',
    tr: 'Turkish', uk: 'Ukrainian', zh: 'Chinese'
  };
  var MAX_SEGMENTS = 40;

  function get(url, timeout, cb) {
    var xhr = new XMLHttpRequest();
    var done = false;
    var timer = setTimeout(function () {
      try { xhr.abort(); } catch (e) {}
      finish(new Error('Caption request timed out'));
    }, timeout);
    function finish(error, text) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(error, text);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      finish(xhr.status === 200 ? null : new Error('HTTP ' + xhr.status), xhr.responseText || '');
    };
    try {
      xhr.open('GET', url, true);
      xhr.send();
    } catch (e) { finish(e); }
    return {
      abort: function () {
        done = true;
        clearTimeout(timer);
        try { xhr.abort(); } catch (e2) {}
      }
    };
  }

  function resolve(uri, base) {
    if (/^https?:\/\//.test(uri)) return uri;
    var origin = /^(https?:\/\/[^\/]+)/.exec(base);
    if (uri.charAt(0) === '/') return origin ? origin[1] + uri : uri;
    return base.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + uri;
  }

  function attributes(line) {
    var out = {};
    var pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    var match;
    while ((match = pattern.exec(line))) out[match[1]] = match[2].replace(/^"|"$/g, '');
    return out;
  }

  function label(name, language) {
    var auto = /auto/i.test(name);
    var code = (language || '').toLowerCase().split('-')[0];
    var base = NAMES[code] || name.replace(/\s*\(auto-generated\)\s*$/i, '') || language || 'Captions';
    return base + (auto ? ' (auto-generated)' : '');
  }

  function parseMaster(text, masterUrl) {
    var tracks = [];
    var seen = {};
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('#EXT-X-MEDIA:') !== 0 || !/TYPE=SUBTITLES/.test(lines[i])) continue;
      var a = attributes(lines[i]);
      if (!a.URI) continue;
      var url = resolve(a.URI, masterUrl);
      if (seen[url]) continue;
      seen[url] = true;
      tracks.push({ url: url, language: a.LANGUAGE || '', name: label(a.NAME || '', a.LANGUAGE || '') });
    }
    return tracks;
  }

  function seconds(stamp) {
    var parts = stamp.replace(',', '.').split(':');
    var total = 0;
    for (var i = 0; i < parts.length; i++) total = total * 60 + parseFloat(parts[i]);
    return total;
  }

  function decode(text) {
    return text.replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  function parseVtt(text) {
    var cues = [];
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split('\n');
      for (var i = 0; i < lines.length; i++) {
        var time = /^\s*((?:\d+:)?\d+:\d+[.,]\d+)\s+-->\s+((?:\d+:)?\d+:\d+[.,]\d+)/.exec(lines[i]);
        if (!time) continue;
        var body = decode(lines.slice(i + 1).join('\n')).replace(/^\s+|\s+$/g, '');
        if (body) cues.push({ start: seconds(time[1]), end: seconds(time[2]), text: body });
        break;
      }
    }
    cues.sort(function (a, b) { return a.start - b.start; });
    return cues;
  }

  function segments(text, playlistUrl) {
    var out = [];
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length && out.length < MAX_SEGMENTS; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, '');
      if (line && line.charAt(0) !== '#') out.push(resolve(line, playlistUrl));
    }
    return out;
  }

  // Lists caption tracks. cb(error, tracks); returns a request with abort().
  function tracks(masterUrl, cb) {
    return get(masterUrl, 8000, function (error, text) {
      cb(error, error ? [] : parseMaster(text, masterUrl));
    });
  }

  // Loads every cue of a track. cb(error, cues); returns a request with abort().
  function load(track, cb) {
    var current = null;
    var cancelled = false;
    current = get(track.url, 8000, function (error, text) {
      if (cancelled) return;
      if (error) return cb(error, []);
      if (/^\s*WEBVTT/.test(text)) return cb(null, parseVtt(text));
      var urls = segments(text, track.url);
      var cues = [];
      var seen = {};
      (function next(index) {
        if (cancelled) return;
        if (index >= urls.length) {
          cues.sort(function (a, b) { return a.start - b.start; });
          return cb(urls.length ? null : new Error('No caption files'), cues);
        }
        current = get(urls[index], 8000, function (segmentError, vtt) {
          if (cancelled) return;
          if (segmentError) return cb(segmentError, []);
          var found = parseVtt(vtt);
          for (var i = 0; i < found.length; i++) {
            var key = found[i].start + '|' + found[i].text;
            if (!seen[key]) { seen[key] = true; cues.push(found[i]); }
          }
          next(index + 1);
        });
      })(0);
    });
    return {
      abort: function () {
        cancelled = true;
        if (current) current.abort();
      }
    };
  }

  function at(cues, time) {
    var text = [];
    for (var i = 0; i < cues.length && cues[i].start <= time; i++) {
      if (time < cues[i].end) text.push(cues[i].text);
    }
    return text.join('\n');
  }

  window.HelloCaptions = { tracks: tracks, load: load, at: at, parseMaster: parseMaster, parseVtt: parseVtt };
})();

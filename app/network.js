// ES5. Network readings for Stats for nerds: how the TV is connected, how fast video
// data is actually arriving from the server it is playing from, and whether that server
// answers. Speed comes from the stream's own segment downloads when hls.js is playing;
// otherwise, and only while the panel is open, from a short ranged request for the
// playing file.
(function () {
  var WINDOW = 120000;       // Speeds older than this are forgotten.
  var PROBE_BYTES = 4194304;
  var PROBE_TIMEOUT = 8000;

  var samples = [];
  var link = null;
  var server = null;
  var lastUrl = '';
  var bridge = null;
  var timer = null;
  var probing = null;
  var urlFor = null;

  function now() { return Date.now(); }

  function host(url) {
    var match = /^https?:\/\/([^\/:?#]+)/.exec(url || '');
    return match ? match[1] : '';
  }

  function trim() {
    var cut = now() - WINDOW;
    while (samples.length && (samples[0].at < cut || samples.length > 60)) samples.shift();
  }

  // One finished (or abandoned) download: bytes received, time spent receiving them,
  // time until the first byte, and the HTTP status (0 when nothing answered).
  function sample(bytes, ms, wait, url, status) {
    if (url) lastUrl = url;
    if (typeof wait === 'number' && wait >= 0) server = { host: host(url || lastUrl), status: status === undefined ? 200 : status, wait: wait, at: now() };
    // Small downloads finish inside one network round trip and say nothing about speed.
    if (bytes >= 262144 && ms > 0) samples.push({ at: now(), mbps: bytes * 8 / ms / 1000 });
    trim();
  }

  function probe(url) {
    if (probing || !url || url.indexOf('http') !== 0) return;
    var xhr = new XMLHttpRequest();
    var started = now();
    var first = 0;
    var loaded = 0;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      probing = null;
      var status = 0;
      try { status = xhr.status; } catch (e) {}
      if (!first && !loaded) {
        server = { host: host(url), status: status, wait: -1, at: now() };
        return;
      }
      sample(loaded, now() - (first || started), (first || now()) - started, '', status);
      server.host = host(url);
    }
    try {
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.setRequestHeader('Range', 'bytes=0-' + (PROBE_BYTES - 1));
      xhr.timeout = PROBE_TIMEOUT;
      xhr.onreadystatechange = function () { if (xhr.readyState >= 2 && !first) first = now(); };
      xhr.onprogress = function (e) { if (!first) first = now(); loaded = e.loaded || loaded; };
      xhr.onload = function () { if (xhr.response && xhr.response.byteLength) loaded = xhr.response.byteLength; finish(); };
      xhr.onerror = finish;
      xhr.ontimeout = finish;
      xhr.onabort = finish;
      probing = xhr;
      xhr.send();
    } catch (e2) {
      probing = null;
    }
  }

  function readLink(message) {
    var data = null;
    try { data = JSON.parse(message); } catch (e) {}
    if (!data || data.returnValue === false) return;
    var wifi = data.wifi || {};
    var wired = data.wired || {};
    link = {
      type: wired.state === 'connected' ? 'Wired' : (wifi.state === 'connected' ? 'Wi-Fi' : ''),
      name: wired.state === 'connected' ? '' : (wifi.displayName || wifi.ssid || ''),
      internet: !!data.isInternetConnectionAvailable
    };
  }

  function watchLink() {
    if (bridge || typeof PalmServiceBridge !== 'function') return;
    try {
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = readLink;
      bridge.call('luna://com.webos.service.connectionmanager/getStatus', '{"subscribe":true}');
    } catch (e) {
      bridge = null;
    }
  }

  function tick() {
    trim();
    var latest = samples.length ? samples[samples.length - 1].at : 0;
    if (now() - latest < 12000) return;
    probe((urlFor && urlFor()) || lastUrl);
  }

  // Called while the panel is open. `currentUrl` returns the file being played when it
  // is not an hls.js stream (those report their own downloads through sample()).
  function start(currentUrl) {
    urlFor = currentUrl || null;
    watchLink();
    clearInterval(timer);
    timer = setInterval(tick, 3000);
    tick();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    urlFor = null;
    if (probing) { try { probing.abort(); } catch (e) {} }
    if (bridge) { try { bridge.cancel(); } catch (e2) {} bridge = null; }
  }

  function speed(value) {
    return value < 10 ? value.toFixed(1) : String(Math.round(value));
  }

  function linkText() {
    if (!link) {
      if (typeof PalmServiceBridge === 'function') return 'Checking';
      return typeof navigator !== 'undefined' && navigator.onLine === false ? 'Offline' : 'Online';
    }
    if (!link.type) return 'Not connected';
    return link.type + (link.name ? ' · ' + link.name : '') + (link.internet ? ' · Internet reachable' : ' · No internet');
  }

  function speedText() {
    trim();
    if (!samples.length) return probing ? 'Measuring' : 'Not measured yet';
    var total = 0;
    var low = samples[0].mbps;
    for (var i = 0; i < samples.length; i++) {
      total += samples[i].mbps;
      if (samples[i].mbps < low) low = samples[i].mbps;
    }
    return speed(samples[samples.length - 1].mbps) + ' Mbps now · ' + speed(total / samples.length) + ' average · ' + speed(low) + ' lowest';
  }

  function serverText() {
    if (!server) return probing ? 'Checking' : 'Not checked yet';
    var name = server.host ? server.host + ' · ' : '';
    if (server.wait < 0) return name + (server.status ? 'Error (HTTP ' + server.status + ')' : 'Not responding');
    if (server.status >= 400) return name + 'Error (HTTP ' + server.status + ')';
    var wait = server.wait >= 1000 ? (server.wait / 1000).toFixed(1) + ' s' : Math.round(server.wait) + ' ms';
    return name + (server.wait >= 2000 ? 'Slow to respond · ' : 'Responding · ') + wait;
  }

  function rows() {
    return [['Network', linkText()], ['Download speed', speedText()], ['Video server', serverText()]];
  }

  window.HelloNetwork = { sample: sample, start: start, stop: stop, rows: rows };
})();

// ES5. Each viewer supplies a personal key. Only ciphertext visits the pairing service.
(function () {
  var API = 'https://api.groq.com/openai/v1';
  var active = false;
  var generation = 0;
  var timer = null;
  var request = null;
  var pairing = null;
  var controls = [];
  var focus = 0;
  var api = { onChange: null };
  function el(id) { return document.getElementById(id); }
  function key() { return window.HelloFavourites ? HelloFavourites.secret('groq') : ''; }
  function b64(bytes) {
    var text = '';
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(text) {
    var raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function hex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }
  function json(method, url, body, token, cb) {
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(error) {
      if (done) return;
      done = true;
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      cb(error, xhr.status, data);
    }
    xhr.open(method, url, true);
    xhr.timeout = 12000;
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    if (body) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () { finish(null); };
    xhr.onerror = xhr.ontimeout = function () { finish(new Error('Could not connect. Check your internet connection and try again.')); };
    xhr.send(body ? JSON.stringify(body) : null);
    return xhr;
  }
  function validate(value, cb) {
    value = String(value || '').replace(/^\s+|\s+$/g, '');
    if (!/^gsk_[A-Za-z0-9_-]{20,256}$/.test(value)) { cb(new Error('Paste the full Groq API key, starting with gsk_.')); return null; }
    return json('GET', API + '/models', null, value, function (error, status, data) {
      if (error) return cb(error);
      if (status === 401 || status === 403) return cb(new Error('Groq did not accept that key. Create a new key and try again.'));
      if (status !== 200 || !data || !data.data) return cb(new Error('Groq is unavailable right now. Try again shortly.'));
      var allowed = false;
      for (var i = 0; i < data.data.length; i++) if (data.data[i].id === 'whisper-large-v3-turbo') allowed = true;
      cb(allowed ? null : new Error('Enable Whisper Large V3 Turbo for this Groq project, then try again.'), value);
    });
  }
  function status(text, failed) {
    el('groqStatus').textContent = text;
    el('groqStatus').className = failed ? 'error' : '';
    updateControls();
  }
  function updateControls() {
    controls = [];
    var nodes = el('groqSetup').querySelectorAll('button, input');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].offsetWidth && !nodes[i].disabled) controls.push(nodes[i]);
    focus = Math.min(focus, controls.length - 1);
  }
  function cancelPairing() {
    generation += 1;
    clearTimeout(timer);
    if (request) request.abort();
    request = null;
    if (pairing) json('DELETE', pairing.base + '/api/pair/' + pairing.id, null, pairing.token, function () {});
    pairing = null;
  }
  function connected(value) {
    if (!HelloFavourites.setSecret('groq', value)) { status('Could not save your key on this device. Try again.', true); return false; }
    if (api.onChange) api.onChange(true);
    cancelPairing();
    el('groqQr').innerHTML = '<span class="groq-done">✓</span>';
    el('groqTitle').textContent = 'Live captions are ready';
    el('groqIntro').textContent = 'Your Groq account is connected to this device.';
    el('groqPair').style.display = 'none';
    el('groqDirect').hidden = true;
    el('groqKey').value = '';
    el('groqManual').hidden = el('groqRetry').hidden = true;
    el('groqDisconnect').hidden = false;
    status('Connected. You can close this window and start watching.');
    return true;
  }
  function beginPairing() {
    cancelPairing();
    var gen = generation;
    var base = String((window.HELLO_TV && HELLO_TV.pairingUrl) || '').replace(/\/$/, '');
    el('groqPair').style.display = '';
    el('groqRetry').hidden = false;
    el('groqQr').innerHTML = '<span class="groq-wait"></span>';
    status('Creating your private connection…');
    if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base)) { status('Phone setup is unavailable. You can enter a key here.', true); return; }
    var secret, token;
    try { secret = nacl.randomBytes(32); token = hex(nacl.randomBytes(32)); }
    catch (error) { status('Phone setup is not supported on this device. Enter a key instead.', true); return; }
    var tokenBytes = new Uint8Array(token.length);
    for (var b = 0; b < token.length; b++) tokenBytes[b] = token.charCodeAt(b);
    request = json('POST', base + '/api/pair', { pollHash: hex(nacl.hash(tokenBytes)) }, null, function (error, code, data) {
      if (gen !== generation || !active) return;
      if (error || code !== 201 || !data || !/^[a-f0-9]{32}$/.test(data.id)) { el('groqQr').innerHTML = ''; status('Phone setup could not connect. Try a new code or enter a key here.', true); return; }
      pairing = { id: data.id, base: base, token: token, expires: Date.now() + 600000 };
      var url = base + '/connect#id=' + data.id + '&secret=' + b64(secret);
      var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      el('groqQr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
      status('Scan the QR code. It expires in 10 minutes.');
      function poll() {
        if (gen !== generation || !active || !pairing) return;
        if (Date.now() >= pairing.expires) { cancelPairing(); el('groqQr').innerHTML = ''; status('This code expired. Choose New QR code to continue.', true); return; }
        request = json('GET', base + '/api/pair/' + data.id, null, token, function (pollError, pollCode, packet) {
          if (gen !== generation || !active) return;
          if (pollCode === 410 || pollCode === 404) { cancelPairing(); el('groqQr').innerHTML = ''; status('This code expired. Choose New QR code to continue.', true); return; }
          if (!pollError && pollCode === 200 && packet && packet.box) {
            var bytes;
            try { bytes = nacl.secretbox.open(unb64(packet.box), unb64(packet.nonce), secret); } catch (e) {}
            if (!bytes) { cancelPairing(); status('Could not verify this connection. Try a new QR code.', true); return; }
            var value = '';
            for (var n = 0; n < bytes.length; n++) value += String.fromCharCode(bytes[n]);
            status('Checking your Groq connection…');
            request = validate(value, function (validationError, validKey) {
              if (gen !== generation || !active) return;
              if (validationError) { cancelPairing(); status(validationError.message, true); return; }
              connected(validKey);
            });
            return;
          }
          timer = setTimeout(poll, pollError || pollCode !== 200 ? 5000 : 2000);
        });
      }
      timer = setTimeout(poll, 1000);
    });
  }
  function close() { cancelPairing(); active = false; el('groqKey').value = ''; el('groqSetup').hidden = true; el('groqSetup').className = ''; }
  function open() {
    active = true; focus = 0;
    el('groqSetup').className = 'on';
    el('groqSetup').hidden = false;
    el('groqDirect').hidden = true;
    el('groqDisconnect').hidden = !key();
    el('groqManual').hidden = el('groqRetry').hidden = false;
    el('groqTitle').textContent = key() ? 'Groq is connected' : 'Connect with your phone';
    el('groqIntro').textContent = key() ? 'Live captions use your own account’s allowance.' : 'Use your own Groq account to add captions when a stream has none.';
    if (key()) { el('groqPair').style.display = 'none'; el('groqManual').hidden = el('groqRetry').hidden = true; status('You can disconnect this device below.'); }
    else beginPairing();
    el('groqClose').focus();
  }
  function init() {
    el('groqClose').onclick = close;
    el('groqSetup').querySelector('.groq-scrim').onclick = close;
    el('groqSetup').onclick = function (e) { e.stopPropagation(); };
    el('groqRetry').onclick = beginPairing;
    el('groqManual').onclick = function () { el('groqDirect').hidden = false; updateControls(); el('groqKey').focus(); };
    el('groqSave').onclick = function () {
      cancelPairing(); var gen = generation;
      status('Checking your Groq connection…');
      el('groqSave').disabled = true;
      request = validate(el('groqKey').value, function (error, value) {
        el('groqSave').disabled = false;
        if (gen !== generation || !active) return;
        if (error) { status(error.message, true); return; }
        connected(value);
      });
    };
    el('groqDisconnect').onclick = function () {
      cancelPairing(); HelloFavourites.setSecret('groq', '');
      if (api.onChange) api.onChange(false);
      close();
    };
  }
  api.key = key;
  api.open = open;
  api.close = close;
  api.isOpen = function () { return active; };
  api.validate = validate;
  api.handleKey = function (e) {
    var code = e.keyCode || e.which;
    var input = document.activeElement === el('groqKey');
    if (code === 27 || code === 461 || (code === 8 && !input)) { e.preventDefault(); close(); return; }
    if (input && code === 13) { e.preventDefault(); el('groqSave').click(); return; }
    if (input && code !== 38 && code !== 40) return;
    updateControls();
    for (var i = 0; i < controls.length; i++) if (controls[i] === document.activeElement) focus = i;
    if (code === 38 || code === 37) focus = Math.max(0, focus - 1);
    else if (code === 40 || code === 39) focus = Math.min(controls.length - 1, focus + 1);
    else return;
    e.preventDefault(); if (controls[focus]) controls[focus].focus();
  };
  window.HelloGroq = api;
  init();
})();

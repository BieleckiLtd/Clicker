// Public broadcast metadata and read-only chat. ES5 for webOS 4.5.
(function () {
  function json(text) { try { return JSON.parse(text); } catch (e) { return null; } }
  function meta(html, name) {
    var tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (var i = 0; i < tags.length; i++) {
      var key = /(?:name|property)=["']([^"']*)["']/i.exec(tags[i]);
      var value = /content=["']([^"']*)["']/i.exec(tags[i]);
      if (key && key[1] === name && value) return value[1];
    }
    return '';
  }
  function metadata(id, html) {
    var state = meta(html, 'twitter:string:broadcast_state').toUpperCase();
    var live = state === 'RUNNING' || state === 'LIVE';
    var ended = state === 'ENDED' || state === 'TIMED_OUT';
    // Scope the SSR fields to this broadcast, without evaluating page scripts.
    var block = /broadcast_by_rest_id:\$R\[\d+\]=\{([\s\S]*?)(?:,user_results:|,view_count_graph:)/.exec(html);
    var fields = block && block[1];
    var bid = fields && /\bbroadcast_id:"([A-Za-z0-9]+)"/.exec(fields);
    var count = fields && bid && bid[1] === id && /\btotal_watching:(\d+)(?=[,}]|$)/.exec(fields);
    var watching = count ? Number(count[1]) : null;
    if (watching !== null && (!isFinite(watching) || watching < 0)) watching = null;
    return {
      live: live, ended: ended, watching: live ? watching : null,
      mediaKey: meta(html, 'twitter:text:broadcast_media_key'),
      chatOff: !!(fields && bid && bid[1] === id && /\bchat_option:1(?=[,}])/.test(fields))
    };
  }
  function message(raw) {
    if (!raw || raw.kind !== 1) return null;
    var outer = typeof raw.payload === 'string' ? json(raw.payload) : raw.payload;
    var body = outer && (typeof outer.body === 'string' ? json(outer.body) : outer.body);
    if (!body || body.type !== 1 || typeof body.body !== 'string' || !body.body) return null;
    var sender = outer.sender || {};
    var time = Number(body.timestamp || outer.timestamp) || 0;
    var name = sender.display_name || body.displayName || sender.username || body.username || 'Viewer';
    var handle = sender.username || body.username || '';
    return {
      id: String(body.uuid || (time + ':' + handle + ':' + body.body)),
      text: body.body, name: name, handle: handle, time: time
    };
  }
  function chatEndpoint(url) {
    return typeof url === 'string' && /^https:\/\/[a-z0-9-]+\.pscp\.tv\/?$/i.test(url);
  }

  function watch(id, onUpdate) {
    var stopped = false, enabled = false, chatGen = 0;
    var metaTimer = null, chatTimer = null, session = null, mediaKey = '';
    var requests = [], messages = [], seen = {}, failures = 0, metaReady = false;
    var info = { live: false, ended: false, watching: null, chatOff: false };
    var chatState = 'idle';

    function publish() {
      if (!stopped) onUpdate({ live: info.live, ended: info.ended, watching: info.watching,
        chatOff: info.chatOff, chatState: chatState, messages: messages.slice() });
    }
    function request(method, url, body, cb, contentType) {
      if (stopped) return;
      var xhr = new XMLHttpRequest(), done = false;
      function finish(error) {
        if (done) return;
        done = true;
        var index = requests.indexOf(xhr);
        if (index >= 0) requests.splice(index, 1);
        if (!stopped) cb(error, xhr.responseText || '');
      }
      requests.push(xhr);
      try {
        xhr.open(method, url, true);
        xhr.timeout = 12000;
        if (body !== null) xhr.setRequestHeader('Content-Type', contentType || 'application/json');
        xhr.onload = function () { finish(xhr.status === 200 ? null : new Error('HTTP ' + xhr.status)); };
        xhr.onerror = xhr.ontimeout = function () { finish(new Error('Network unavailable')); };
        xhr.send(body === null ? null : JSON.stringify(body));
      } catch (e) { finish(e); }
    }
    function chatFailed(gen) {
      if (!enabled || gen !== chatGen || stopped) return;
      session = null;
      failures += 1;
      chatState = 'error';
      publish();
      clearTimeout(chatTimer);
      // Bounded retries; OK or reopening the tab starts another attempt.
      if (failures < 3) chatTimer = setTimeout(startChat, 10000);
    }
    function history(gen, cursor, page) {
      if (!enabled || gen !== chatGen || !session || stopped) return;
      request('POST', session.endpoint + '/chatapi/v1/history', {
        access_token: session.token, cursor: cursor || '', limit: 300,
        since: info.live ? (Date.now() - 300000) * 1000000 : null, quick_get: !info.live
      }, function (error, text) {
        if (!enabled || gen !== chatGen) return;
        var data = !error && json(text);
        if (!data || !data.messages || typeof data.messages.length !== 'number') return chatFailed(gen);
        for (var i = 0; i < data.messages.length; i++) {
          var item = message(data.messages[i]);
          if (item && !seen['$' + item.id]) { messages.push(item); seen['$' + item.id] = true; }
        }
        messages.sort(function (a, b) { return a.time - b.time; });
        if (messages.length > 300) messages = messages.slice(-300);
        seen = {};
        for (var j = 0; j < messages.length; j++) seen['$' + messages[j].id] = true;
        chatState = 'ready';
        failures = 0;
        publish();
        if (data.cursor && data.cursor !== cursor && page < 4) {
          history(gen, data.cursor, page + 1);
        } else if (info.live) chatTimer = setTimeout(function () { history(gen, '', 0); }, 3000);
      });
    }
    function startChat() {
      clearTimeout(chatTimer);
      if (!enabled || stopped) return;
      if (!mediaKey) { chatState = metaReady ? 'error' : 'loading'; publish(); return; }
      var gen = ++chatGen;
      if (info.chatOff) { chatState = 'off'; publish(); return; }
      chatState = 'loading';
      publish();
      // This endpoint works without a guest bearer or account cookies.
      request('GET', 'https://api.x.com/1.1/live_video_stream/status/' + encodeURIComponent(mediaKey) +
        '.json?location_sharing_rules_enforced=false&stream_type=hls', null, function (error, text) {
        if (!enabled || gen !== chatGen) return;
        var status = !error && json(text);
        if (!status || !status.chatToken) return chatFailed(gen);
        // The public endpoint now accepts POST only (GET returns 404, checked 2026-11-12).
        // A text/plain body keeps it a simple request, with no CORS preflight.
        request('POST', 'https://proxsee-cf.pscp.tv/api/v2/accessChatPublic', { chat_token: status.chatToken }, function (err, result) {
          if (!enabled || gen !== chatGen) return;
          var access = !err && json(result);
          var endpoint = access && ((!info.live && access.replay_endpoint) || access.endpoint);
          var token = access && ((!info.live && access.replay_access_token) || access.access_token);
          // X answers ended broadcasts with an empty chat server: their chat history is gone.
          if (access && !info.live && info.ended && !endpoint) { chatState = 'unavailable'; publish(); return; }
          if (!chatEndpoint(endpoint) || typeof token !== 'string' || !token) return chatFailed(gen);
          session = { endpoint: endpoint.replace(/\/$/, ''), token: token };
          history(gen, '', 0);
        }, 'text/plain');
      });
    }
    function refresh() {
      request('GET', 'https://x.com/i/broadcasts/' + encodeURIComponent(id), null, function (error, html) {
        metaReady = true;
        var previous = info;
        var previousKey = mediaKey;
        if (!error) {
          var fresh = metadata(id, html);
          if (!fresh.mediaKey && !fresh.live && !fresh.ended) error = new Error('Metadata unavailable');
          else { info = fresh; mediaKey = fresh.mediaKey || mediaKey; }
        }
        if (error) info.watching = null; // Never leave an old count looking current.
        if (enabled && !mediaKey) chatState = 'error';
        publish();
        if (enabled && mediaKey && (chatState === 'idle' || !previousKey || previous.ended !== info.ended || previous.chatOff !== info.chatOff)) startChat();
        if (!info.ended || error) metaTimer = setTimeout(refresh, 15000);
      });
    }
    refresh();
    return {
      setChatEnabled: function (value) {
        if (enabled === value) return;
        enabled = value;
        chatGen += 1;
        clearTimeout(chatTimer);
        session = null;
        failures = 0;
        if (enabled) startChat();
        else chatState = 'idle';
      },
      retry: function () { failures = 0; if (mediaKey) startChat(); else { clearTimeout(metaTimer); refresh(); } },
      close: function () {
        stopped = true;
        chatGen += 1;
        clearTimeout(metaTimer);
        clearTimeout(chatTimer);
        for (var i = 0; i < requests.length; i++) try { requests[i].abort(); } catch (e) {}
        requests = [];
        session = null;
      }
    };
  }
  window.HelloBroadcast = { watch: watch };
})();

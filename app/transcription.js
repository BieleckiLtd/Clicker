// ES5. Reuse hls.js's demuxed audio; no microphone, PC, or audio relay is needed.
(function () {
  var API = 'https://api.groq.com/openai/v1/audio/transcriptions';
  function attach(hls, video, options) {
    var enabled = false, closed = false, xhr = null, generation = 0;
    var init = null, mime = 'audio/mp4', fragments = [], cues = [];
    var nextAt = 0, failures = 0, lastStatus = '';
    function status(text) { if (text !== lastStatus) { lastStatus = text; if (options.onStatus) options.onStatus(text); } }
    function bytes(data) { return data instanceof Uint8Array ? data : new Uint8Array(data); }
    function isInit(data) {
      if (data.length < 8) return false;
      var type = String.fromCharCode(data[4], data[5], data[6], data[7]);
      return type === 'ftyp' || type === 'moov';
    }
    function codecs(event, data) {
      var track = data.audio || data.audiovideo;
      if (track) { init = track.initSegment ? bytes(track.initSegment).slice() : null; mime = track.container || 'audio/mp4'; }
    }
    function append(event, data) {
      if (closed || (data.type !== 'audio' && data.type !== 'audiovideo')) return;
      var raw = bytes(data.data);
      if (isInit(raw)) { init = raw.slice(); return; }
      var frag = data.frag;
      if (!frag || typeof frag.start !== 'number' || !frag.duration || !raw.length) return;
      var id = frag.cc + ':' + frag.sn + ':' + frag.start;
      var entry = null;
      for (var i = 0; i < fragments.length; i++) if (fragments[i].id === id) entry = fragments[i];
      if (!entry) {
        entry = { id: id, cc: frag.cc, start: frag.start, end: frag.start + frag.duration, parts: [], size: 0, init: init, mime: mime, done: false, complete: false };
        fragments.push(entry);
      }
      entry.parts.push(raw.slice()); entry.size += raw.byteLength;
      // Keep only a small recent window; never retain a complete broadcast in memory.
      var total = 0;
      for (var n = fragments.length - 1; n >= 0; n--) total += fragments[n].size;
      while (fragments.length > 12 || (total > 16000000 && fragments.length > 1)) total -= fragments.shift().size;
    }
    function buffered(event, data) {
      if (!data.frag) return;
      var id = data.frag.cc + ':' + data.frag.sn + ':' + data.frag.start;
      for (var i = 0; i < fragments.length; i++) if (fragments[i].id === id) fragments[i].complete = true;
      pump();
    }
    function pump() {
      if (!enabled || closed || xhr || video.paused || Date.now() < nextAt || !window.HelloGroq || !HelloGroq.key()) return;
      var now = video.currentTime || 0;
      var batch = [];
      fragments.sort(function (a, b) { return a.start - b.start; });
      for (var i = 0; i < fragments.length; i++) {
        var entry = fragments[i];
        if (entry.done || !entry.complete || entry.end < now - 2 || entry.start > now + 14) continue;
        if (batch.length && (entry.cc !== batch[0].cc || entry.start > batch[batch.length - 1].end + 0.5 || entry.init !== batch[0].init)) break;
        batch.push(entry);
        if (entry.end - batch[0].start >= 8) break;
      }
      if (!batch.length) return;
      var start = batch[0].start, end = batch[batch.length - 1].end;
      if (end - start < 8 && end > now + 1 && !video.ended) return;
      var parts = batch[0].init ? [batch[0].init] : [];
      for (var b = 0; b < batch.length; b++) parts = parts.concat(batch[b].parts);
      var blob = new Blob(parts, { type: batch[0].mime });
      if (blob.size > 24000000) { for (var big = 0; big < batch.length; big++) batch[big].done = true; status('This stream’s audio segment is too large for live captions.'); return; }
      var form = new FormData();
      form.append('file', blob, batch[0].mime.indexOf('mpeg') !== -1 ? 'audio.mp3' : 'audio.m4a');
      form.append('model', 'whisper-large-v3-turbo');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      form.append('temperature', '0');
      var gen = generation;
      var request = xhr = new XMLHttpRequest();
      request.open('POST', API, true);
      request.timeout = 25000;
      request.setRequestHeader('Authorization', 'Bearer ' + HelloGroq.key());
      status('Listening…');
      var finished = false;
      function finish(networkError) {
        if (finished) return; finished = true;
        if (closed || gen !== generation) return;
        xhr = null;
        nextAt = Date.now() + 4000;
        if (!networkError && request.status === 200) {
          var data;
          try { data = JSON.parse(request.responseText); } catch (e) {}
          if (!data || typeof data.text !== 'string') { failed('Groq returned an unreadable transcript.'); return; }
          for (var d = 0; d < batch.length; d++) batch[d].done = true;
          failures = 0;
          var segments = data.segments && data.segments.length ? data.segments : [{ start: 0, end: end - start, text: data.text }];
          var current = video.currentTime || 0;
          for (var s = 0; s < segments.length; s++) {
            var seg = segments[s];
            if (!seg.text || seg.no_speech_prob > 0.8 || !isFinite(seg.start) || !isFinite(seg.end)) continue;
            var cueStart = start + Math.max(0, seg.start), cueEnd = start + Math.min(end - start, seg.end);
            if (cueEnd <= current && current - cueEnd < 8) { cueStart = current; cueEnd = current + Math.min(5, Math.max(2, seg.end - seg.start)); }
            if (cueEnd > cueStart && cueEnd >= current - 1) cues.push({ start: cueStart, end: cueEnd, text: seg.text.replace(/^\s+|\s+$/g, '') });
          }
          cues = cues.filter(function (cue) { return cue.end >= current - 30; }).slice(-100);
          cues.sort(function (a, b) { return a.start - b.start; });
          if (options.onCues) options.onCues(cues.slice());
          status(data.text ? 'Live transcription is on' : 'Listening for speech…');
        } else if (request.status === 401 || request.status === 403) { enabled = false; status('Groq rejected your key. Reconnect in Settings → Live captions.'); }
        else if (request.status === 429) {
          var retry = parseInt(request.getResponseHeader('retry-after'), 10) || 60;
          nextAt = Date.now() + Math.max(5000, Math.min(retry * 1000, 3600000));
          status('Groq’s free limit was reached. Captions will retry automatically.');
        } else if (request.status === 400 || request.status === 413 || request.status === 415) { enabled = false; status('Groq could not read this stream’s audio. Other streams may work.'); }
        else failed('Live captions could not connect. Retrying…');
      }
      function failed(text) { failures += 1; nextAt = Date.now() + Math.min(60000, 5000 * failures); status(text); }
      request.onload = function () { finish(false); };
      request.onerror = request.ontimeout = function () { finish(true); };
      request.send(form);
    }
    function seeked() {
      generation += 1; if (xhr) xhr.abort(); xhr = null;
      cues = []; nextAt = 0;
      for (var i = 0; i < fragments.length; i++) fragments[i].done = false;
      if (options.onCues) options.onCues([]);
      pump();
    }
    hls.on(Hls.Events.BUFFER_CODECS, codecs);
    hls.on(Hls.Events.BUFFER_APPENDING, append);
    hls.on(Hls.Events.FRAG_BUFFERED, buffered);
    video.addEventListener('timeupdate', pump);
    video.addEventListener('playing', pump);
    video.addEventListener('seeked', seeked);
    return {
      enable: function (on) {
        enabled = !!on; generation += 1;
        if (xhr) xhr.abort(); xhr = null;
        if (!enabled) { cues = []; if (options.onCues) options.onCues([]); status(''); }
        else { nextAt = 0; status('Listening for the next audio segment…'); pump(); }
      },
      stop: function () {
        closed = true; generation += 1; if (xhr) xhr.abort(); xhr = null;
        hls.off(Hls.Events.BUFFER_CODECS, codecs); hls.off(Hls.Events.BUFFER_APPENDING, append); hls.off(Hls.Events.FRAG_BUFFERED, buffered);
        video.removeEventListener('timeupdate', pump); video.removeEventListener('playing', pump); video.removeEventListener('seeked', seeked);
        fragments = []; cues = []; init = null;
      }
    };
  }
  window.HelloTranscription = { attach: attach };
})();

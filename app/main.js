// Plain ES5. webOS 4.5 is Chromium 53: no arrows, let/const, or template strings.
(function () {
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, RW: 412, FF: 417
  };
  var PC_KEYS = { 27: KEY.BACK, 8: KEY.BACK };

  var KEYBOARD = [
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    ['j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r'],
    ['s', 't', 'u', 'v', 'w', 'x', 'y', 'z', '⌫'],
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    ['0', '_', 'space', 'clear']
  ];
  var CHIPS = ['All', 'Live', 'Videos', 'Channels'];
  var COLS = 3;
  var HOME_COLS = 4;
  var BRAND_SYMBOL = 'clicker-symbol.svg';
  var state = {
    screen: 'browse',
    zone: 'rows',
    navIndex: 0,
    browseIndex: 0,
    browseChipIndex: 0,
    browseChipFocus: 0,
    focusId: null,
    data: null,
    historyOpen: false,
    historyReturn: null,
    loading: false,
    searchQuery: '',
    keyRow: 0,
    keyCol: 0,
    gridIndex: 0,
    chipIndex: 0,
    searchProfiles: [],
    searchItems: [],
    searchFocusId: null,
    searchError: '',
    searchCompleted: 0,
    searchTotal: 0,
    searchResolveIds: {},
    searchResolveQueue: [],
    searchResolveCount: 0,
    searchResolveActive: 0,
    searchGen: 0,
    searchTimer: null,
    searching: false,
    resumeScreen: 'browse',
    opening: false,
    playGen: 0,
    playing: null,
    queue: null,
    filmstripIndex: -1,
    hasPlayed: false,
    hls: null,
    qualityOpen: false,
    qualityIndex: 0,
    restoreTime: null,
    restorePaused: false,
    statsOn: false,
    statsTimer: null,
    bufferingTimer: null,
    downloadFrag: null,
    mp4FrameRate: null,
    hlsFrameRates: {},
    playerZone: 'timeline',
    playerAction: 0,
    recoveryCount: 0,
    recoveryTried: {},
    recoveryRefreshed: false,
    recoveryBusy: false,
    recoveryFailed: false,
    recoveryToken: 0,
    recoveryTimer: null,
    recoveryMessage: '',
    wantPaused: false,
    pendingQuality: null,
    lastPositionSave: 0,
    postOpen: false,
    postTab: 0,
    postGen: 0,
    comments: [],
    commentsLoaded: false,
    commentsLoading: false,
    commentsError: false,
    commentsCursor: null,
    broadcast: null,
    broadcastInfo: null,
    controlsTimer: null,
    overlayDismissed: false,
    iconTimer: null,
    seekTimer: null,
    animateGrid: false,
    animateResults: false,
    resultsGen: -1,
    settingsOpen: false,
    settingsIndex: 0,
    captionsOpen: false,
    captionsIndex: 0,
    captionGen: 0,
    captionRequest: null,
    captionTracks: null,
    captionTrack: -1,
    captionCues: [],
    captionLoading: false,
    captionShown: ''
  };
  var SETTINGS = [
    { id: 'motion', name: 'Animations', desc: 'Smooth scrolling, focus zoom and transitions. Turn off for quicker, simpler navigation on older TVs.' },
    { id: 'artwork', name: 'Background artwork', desc: 'Show the selected video’s picture behind the page title.' }
  ];
  var prefs = { motion: true, artwork: true, captions: '', qualityHeight: 0 };
  state.aiCaptions = false;
  state.aiStatus = '';
  state.transcriber = null;
  // Older TV browsers (webOS 4.5 is Chromium 53 on a slow TV chip) get the light variants of
  // the most expensive effects; measured on the TV, the full versions ran at 10-25 fps.
  var chromeVersion = /Chrome\/(\d+)/.exec(navigator.userAgent || '');
  var lite = !!chromeVersion && parseInt(chromeVersion[1], 10) < 80;
  var searchPainted = null;
  var homeChipsPainted = null;
  var channelDrag = null;
  var channelDragPreview = null;
  var channelDragClickUntil = 0;
  var toastTimer = null;
  var shownTitle = null;
  var rowsPainted = null;
  var browseItems = [];
  var pointerFocus = false;
  var navPointerFocus = false;
  var backdropUrl = '';
  var backdropTimer = null;
  var gridSettleAt = 0;
  var gridDeferred = null;
  var resultsSettleAt = 0;
  var resultsDeferred = null;

  function loadPrefs() {
    var saved = window.HelloFavourites && HelloFavourites.settings ? HelloFavourites.settings() : {};
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    prefs.motion = typeof saved.motion === 'boolean' ? saved.motion : !reduce;
    prefs.artwork = typeof saved.artwork === 'boolean' ? saved.artwork : true;
    prefs.captions = typeof saved.captions === 'string' ? saved.captions : '';
    prefs.qualityHeight = typeof saved.qualityHeight === 'number' && saved.qualityHeight > 0 ? saved.qualityHeight : 0;
    applyPrefs();
  }

  function applyPrefs() {
    document.documentElement.className = (prefs.motion ? 'motion' : '') + (prefs.artwork ? ' artwork' : '') + (lite ? ' lite' : '');
    if (!prefs.artwork) clearBackdrop();
  }

  // Restart a one-shot CSS animation class.
  function replay(el, cls) {
    if (!prefs.motion || !el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function withPointer(fn) {
    pointerFocus = true;
    try { fn(); } finally { pointerFocus = false; }
  }

  function translateY(el) {
    var value = window.getComputedStyle(el).transform;
    if (!value || value === 'none') return 0;
    var parts = value.slice(value.indexOf('(') + 1, -1).split(',');
    return parseFloat(parts[parts.length === 16 ? 13 : 5]) || 0;
  }

  // Sets scrollTop at once (focus logic depends on it), then animates the grid from its
  // previous on-screen position so the move looks continuous.
  function scrollHost(host, target) {
    target = Math.max(0, Math.min(Math.round(target), host.scrollHeight - host.clientHeight));
    var from = host.scrollTop;
    if (Math.abs(target - from) < 1) return;
    host.scrollTop = target;
    var grid = host.querySelector('.grid');
    if (!prefs.motion || !grid) return;
    var offset = translateY(grid) + host.scrollTop - from;
    grid.style.transition = 'none';
    grid.style.transform = 'translateY(' + offset + 'px)';
    void grid.offsetHeight;
    grid.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
    grid.style.transform = 'translateY(0)';
  }

  function topWithin(host, el) {
    var top = 0;
    while (el && el !== host) {
      top += el.offsetTop;
      el = el.offsetParent;
    }
    return top;
  }

  // Remote focus keeps the focused row at the top; the pointer only scrolls what is cut off.
  function revealCard(host, card) {
    var top = topWithin(host, card);
    if (!pointerFocus) scrollHost(host, top - 28);
    else if (top - 28 < host.scrollTop) scrollHost(host, top - 28);
    else if (top + card.offsetHeight + 48 > host.scrollTop + host.clientHeight) {
      scrollHost(host, top + card.offsetHeight + 48 - host.clientHeight);
    }
  }

  function gridHTML(html, animate) {
    return '<div class="grid' + (animate ? ' enter' : '') + '">' + html + '<div class="focus-ring" aria-hidden="true"></div></div>';
  }

  // One pre-drawn focus ring per grid glides between cards. Moving it is a compositor-only
  // transform, so a focus change never repaints the grid; on the webOS 4.5 TV each grid
  // repaint after a key press cost 25-45 ms and dropped frames at the start of every move.
  function placeRing(host, card) {
    var ring = host.querySelector('.focus-ring');
    if (!ring) return;
    if (!card) {
      ring.className = 'focus-ring';
      return;
    }
    var box = card.querySelector('.thumb') || card;
    var x = card.offsetLeft + (box === card ? 0 : box.offsetLeft);
    var y = card.offsetTop + (box === card ? 0 : box.offsetTop);
    var width = box.offsetWidth + 'px';
    var height = box.offsetHeight + 'px';
    var radius = box === card ? '20px' : '14px';
    var shown = ring.className === 'focus-ring on';
    if (!shown) ring.style.transition = 'none';
    if (ring.style.width !== width) ring.style.width = width;
    if (ring.style.height !== height) ring.style.height = height;
    if (ring.style.borderRadius !== radius) ring.style.borderRadius = radius;
    ring.style.transform = 'translate(' + x + 'px,' + y + 'px)' + (prefs.motion ? (box === card ? ' scale(1.05)' : ' scale(1.06)') : '');
    ring.className = 'focus-ring on';
    if (!shown) {
      void ring.offsetWidth;
      ring.style.transition = '';
    }
  }

  function settleGrid(host) {
    setTimeout(function () {
      var grid = host.querySelector('.grid.enter');
      if (grid) grid.className = 'grid';
    }, 900);
    return Date.now() + 800;
  }

  function clearBackdrop() {
    backdropUrl = '';
    clearTimeout(backdropTimer);
    var layers = document.querySelectorAll('#backdrop .bd');
    for (var i = 0; i < layers.length; i++) layers[i].className = 'bd';
  }

  function paintBackdrop(item) {
    if (!prefs.artwork) return;
    var url = item && item.thumbnail ? assetUrl(item.thumbnail) : '';
    if (url === backdropUrl) return;
    backdropUrl = url;
    clearTimeout(backdropTimer);
    backdropTimer = setTimeout(function () {
      var layers = document.querySelectorAll('#backdrop .bd');
      var current = layers[0].className === 'bd on' ? layers[0] : layers[1];
      var next = current === layers[0] ? layers[1] : layers[0];
      if (!url) {
        current.className = 'bd';
        return;
      }
      var image = new Image();
      image.onload = function () {
        if (backdropUrl !== url || !prefs.artwork) return;
        next.style.backgroundImage = 'url("' + url.replace(/["\\\r\n]/g, '') + '")';
        next.className = 'bd on';
        current.className = 'bd';
      };
      image.src = url;
    }, 650);
  }

  function mediaUrl(item) {
    return (item.playback && item.playback.url) || '';
  }

  function assetUrl(url) {
    return url || '';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderEmoji(root) {
    if (window.twemoji) twemoji.parse(root, { base: 'vendor/twemoji/', folder: 'svg', ext: '.svg' });
  }

  var CHECK = '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

  function panelClose(id) {
    return '<button id="' + id + '" class="panel-close" type="button" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
  }

  function playerMenuOpen() {
    return state.qualityOpen || state.postOpen || state.captionsOpen;
  }

  function paintPlayerActions() {
    var menu = playerMenuOpen();
    document.getElementById('postButton').setAttribute('aria-pressed', state.postOpen ? 'true' : 'false');
    document.getElementById('qualityButton').setAttribute('aria-expanded', state.qualityOpen ? 'true' : 'false');
    document.getElementById('captionsButton').setAttribute('aria-expanded', state.captionsOpen ? 'true' : 'false');
    var buttons = document.querySelectorAll('.player-controls .player-action');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle('focused', state.playerZone === 'controls' && state.playerAction === i && !menu);
    document.getElementById('playerBack').classList.toggle('focused', state.playerZone === 'back' && !menu);
    document.getElementById('timeline').className = 'scrub' + (state.playerZone === 'timeline' && !menu ? ' focused' : '');
    var cards = document.querySelectorAll('#filmstrip .filmstrip-card');
    for (var c = 0; c < cards.length; c++) {
      cards[c].classList.toggle('focused', state.playerZone === 'filmstrip' && +cards[c].getAttribute('data-index') === state.filmstripIndex && !menu);
    }
  }

  function paintPlayButton() {
    var video = document.getElementById('video');
    var paused = video.paused || video.ended;
    var button = document.getElementById('playButton');
    button.classList.toggle('paused', paused);
    button.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  // Captions: tracks come from the video's HLS master; the app draws the cues itself.
  function paintCaptionText() {
    var video = document.getElementById('video');
    var text = (state.captionTrack >= 0 || state.aiCaptions) && window.HelloCaptions ? HelloCaptions.at(state.captionCues, video.currentTime) : '';
    if (text === state.captionShown) return;
    state.captionShown = text;
    document.getElementById('captions').innerHTML = text ? '<span>' + esc(text).replace(/\n/g, '<br>') + '</span>' : '';
  }

  function paintCaptionsButton() {
    var button = document.getElementById('captionsButton');
    button.setAttribute('aria-pressed', state.captionTrack >= 0 || state.aiCaptions ? 'true' : 'false');
    button.classList.toggle('unavailable', !!state.captionTracks && !state.captionTracks.length && !(window.HelloGroq && HelloGroq.key()));
  }

  function resetCaptions(item) {
    state.captionGen += 1;
    if (state.captionRequest) state.captionRequest.abort();
    state.captionRequest = null;
    state.aiCaptions = false;
    state.aiStatus = '';
    if (state.transcriber) state.transcriber.enable(false);
    var source = item && !item.live && window.HelloCaptions ? item.captionSource || item.masterUrl : '';
    state.captionTracks = source ? null : [];
    state.captionTrack = -1;
    state.captionCues = [];
    state.captionLoading = false;
    paintCaptionText();
    paintCaptionsButton();
    if (!source) {
      if (item && (prefs.captions === 'ai' || prefs.captions === 'auto') && window.HelloGroq && HelloGroq.key()) chooseAiCaption(false);
      return;
    }
    var gen = state.captionGen;
    state.captionRequest = HelloCaptions.tracks(source, function (error, tracks) {
      if (gen !== state.captionGen) return;
      state.captionRequest = null;
      state.captionTracks = tracks || [];
      if (prefs.captions === 'auto' && state.captionTracks.length) chooseCaption(0, false);
      else if ((prefs.captions === 'ai' || prefs.captions === 'auto') && window.HelloGroq && HelloGroq.key()) chooseAiCaption(false);
      for (var i = 0; i < state.captionTracks.length && prefs.captions; i++) {
        var track = state.captionTracks[i];
        if ((track.language || track.name) === prefs.captions) { chooseCaption(i, false); break; }
      }
      paintCaptionsButton();
      if (state.captionsOpen) paintCaptionsMenu();
    });
  }

  function chooseCaption(index, remember) {
    state.aiCaptions = false;
    state.aiStatus = '';
    if (state.transcriber) state.transcriber.enable(false);
    var tracks = state.captionTracks || [];
    var track = tracks[index];
    state.captionGen += 1;
    if (state.captionRequest) state.captionRequest.abort();
    state.captionRequest = null;
    state.captionLoading = false;
    state.captionCues = [];
    state.captionTrack = track ? index : -1;
    if (remember) {
      prefs.captions = track ? track.language || track.name : '';
      if (window.HelloFavourites && HelloFavourites.setSetting) HelloFavourites.setSetting('captions', prefs.captions);
    }
    paintCaptionText();
    paintCaptionsButton();
    if (state.captionsOpen) paintCaptionsMenu();
    if (!track) return;
    var gen = state.captionGen;
    state.captionLoading = true;
    state.captionRequest = HelloCaptions.load(track, function (error, cues) {
      if (gen !== state.captionGen) return;
      state.captionRequest = null;
      state.captionLoading = false;
      state.captionCues = cues || [];
      if (error && !state.captionCues.length) {
        state.captionTrack = -1;
        showToast("Captions couldn't load. Try again.");
      }
      paintCaptionText();
      paintCaptionsButton();
      if (state.captionsOpen) paintCaptionsMenu();
    });
  }

  function chooseAiCaption(remember) {
    if (!window.HelloGroq || !HelloGroq.key()) { HelloGroq.open(); return; }
    state.captionGen += 1;
    if (state.captionRequest) state.captionRequest.abort();
    state.captionRequest = null;
    state.captionTrack = -1;
    state.captionLoading = false;
    state.captionCues = [];
    state.aiCaptions = true;
    if (remember) {
      prefs.captions = 'ai';
      HelloFavourites.setSetting('captions', 'ai');
    }
    state.aiStatus = state.transcriber ? 'Listening for speech…' : 'Live transcription is available for supported HLS streams.';
    if (state.transcriber) state.transcriber.enable(true);
    paintCaptionText(); paintCaptionsButton();
  }

  function captionOptions() {
    var tracks = state.captionTracks || [];
    var options = [{ name: 'Off', index: -1 }];
    for (var i = 0; i < tracks.length; i++) options.push({ name: tracks[i].name, index: i });
    options.push({ name: window.HelloGroq && HelloGroq.key() ? 'Live transcription · Groq' : 'Set up live transcription', index: -2 });
    return options;
  }

  function selectCaptionOption(index) {
    var option = captionOptions()[index];
    if (!option) return;
    if (option.index === -2) chooseAiCaption(true);
    else chooseCaption(option.index, true);
    closeCaptionsMenu();
  }

  function paintCaptionsMenu() {
    var tracks = state.captionTracks || [];
    var options = captionOptions();
    state.captionsIndex = Math.max(0, Math.min(state.captionsIndex, options.length - 1));
    var html = '<div class="quality-note">Captions</div>';
    for (var o = 0; o < options.length; o++) {
      var on = state.aiCaptions ? options[o].index === -2 : options[o].index === state.captionTrack;
      html += '<button type="button" class="quality-option' + (state.captionsIndex === o ? ' focused' : '') + '" data-i="' + o + '"' +
        (on ? ' aria-current="true"' : '') + '>' + esc(options[o].name) + (on ? (state.captionLoading ? ' · Loading' : CHECK) : '') + '</button>';
    }
    if (!state.captionTracks) html += '<div class="quality-note">Checking for captions…</div>';
    else if (!tracks.length) html += '<div class="quality-note">This video has no captions.</div>';
    if (state.aiCaptions && state.aiStatus) html += '<div class="quality-note">' + esc(state.aiStatus) + '</div>';
    var menu = document.getElementById('captionsMenu');
    menu.innerHTML = html;
    menu.className = 'on';
    var buttons = menu.querySelectorAll('.quality-option');
    for (var b = 0; b < buttons.length; b++) {
      (function (button, index) {
        button.onclick = function (e) {
          e.stopPropagation();
          selectCaptionOption(index);
        };
      })(buttons[b], b);
    }
  }

  function openCaptionsMenu() {
    if (!state.playing) return;
    if (state.postOpen) togglePost();
    if (state.qualityOpen) closeQualityMenu();
    closeFilmstrip();
    state.captionsOpen = true;
    state.playerZone = 'controls';
    state.playerAction = 1;
    state.captionsIndex = state.aiCaptions ? captionOptions().length - 1 : state.captionTrack + 1;
    paintPlayerActions();
    showControls(true);
    paintCaptionsMenu();
  }

  function closeCaptionsMenu() {
    state.captionsOpen = false;
    document.getElementById('captionsMenu').className = '';
    paintPlayerActions();
    showControls(false);
  }

  function toggleCaptionsMenu() {
    if (state.captionsOpen) closeCaptionsMenu();
    else openCaptionsMenu();
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatDuration(sec) {
    sec = Math.round(sec || 0);
    if (sec < 0 || !isFinite(sec)) sec = 0;
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  // "1.2M", "7.9K", "235". Missing or zero counts give ''.
  function compactNumber(n) {
    n = Number(n);
    if (!n || n < 0) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // "1.2M views", "1 like". Missing or zero counts give ''.
  function formatCount(n, word) {
    var short = compactNumber(n);
    if (!short) return '';
    return short + ' ' + word + (Number(n) === 1 ? '' : 's');
  }

  function formatViews(n) {
    return formatCount(n, 'view');
  }

  function timeAgo(ms) {
    if (!ms) return '';
    var min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return min + 'm ago';
    var h = Math.floor(min / 60);
    if (h < 24) return h + 'h ago';
    var days = Math.floor(h / 24);
    if (days < 14) return days + 'd ago';
    return Math.floor(days / 7) + 'w ago';
  }

  function metaLine(item) {
    var parts = [];
    if (item.authorName) parts.push(item.authorName);
    if (item.live) parts.push('Live');
    else if (item.publishedAt) parts.push(timeAgo(item.publishedAt));
    if (!item.live) {
      var views = formatViews(item.views);
      if (views) parts.push(views);
    }
    return parts.join(' · ');
  }

  var STAT_ICONS = {
    comment: '<path d="M6.5 4.5h11a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5v-3.5h0A2.5 2.5 0 0 1 4 14V7a2.5 2.5 0 0 1 2.5-2.5z"/>',
    repost: '<path d="M7 20.5 4 17.5l3-3"/><path d="M4 17.5h10.5a4.5 4.5 0 0 0 4.5-4.5v-1"/><path d="m17 3.5 3 3-3 3"/><path d="M20 6.5H9.5A4.5 4.5 0 0 0 5 11v1"/>',
    like: '<path d="M12 20s-8-4.7-8-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8 2.4C20 15.3 12 20 12 20z"/>',
    view: '<path d="M5 19.5v-5M10 19.5v-11M15 19.5v-8M20 19.5v-15"/>'
  };

  // Player subtitle (HTML): author and age, then comments, reposts and likes as icon + number, views last.
  function playerMetaHtml(item) {
    var parts = [];
    if (item.authorName) parts.push(item.authorName);
    if (item.live) parts.push('Live');
    else if (item.publishedAt) parts.push(timeAgo(item.publishedAt));
    var stats = [['comment', item.replyCount], ['repost', item.repostCount], ['like', item.likeCount]];
    if (!item.live) stats.push(['view', item.views]);
    var html = '<span class="pmeta">' + esc(parts.join(' · ')) + '</span>';
    for (var i = 0; i < stats.length; i++) {
      var short = compactNumber(stats[i][1]);
      if (!short) continue;
      html += '<span class="pstat" data-stat="' + stats[i][0] + '" aria-label="' + esc(formatCount(stats[i][1], stats[i][0])) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + STAT_ICONS[stats[i][0]] + '</svg>' + short + '</span>';
    }
    return html;
  }

  function rowsOf() {
    return (state.data && state.data.rows) || [];
  }

  function homeOptions() {
    if (state.historyOpen) return [{ id: 'history', title: 'All' }, { id: 'in-progress', title: 'In progress' }, { id: 'watched', title: 'Watched' }];
    var options = [{ id: 'hot', title: 'Hot' }, { id: 'live', title: 'Live' }, { id: 'videos', title: 'Videos' }];
    var rows = rowsOf();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === 'featured' || rows[i].id === 'live' || rows[i].id === 'latest') continue;
      options.push({ id: 'channel:' + rows[i].id, title: rows[i].title, avatar: rows[i].avatar, row: rows[i] });
    }
    return options;
  }

  function hotScore(item, now) {
    var hours = Math.max(0, (now - (item.publishedAt || now)) / 3600000);
    return Math.max(0, Number(item.views) || 0) / Math.pow(hours + 2, 1.5);
  }

  function homeItems() {
    var options = homeOptions();
    if (state.browseChipIndex >= options.length) state.browseChipIndex = 0;
    var option = options[state.browseChipIndex];
    if (state.historyOpen) {
      var entries = window.HelloFavourites ? HelloFavourites.history() : [];
      var historyItems = [];
      for (var h = 0; h < entries.length; h++) {
        var progress = HelloFavourites.progress(entries[h].id);
        if (option.id === 'in-progress' && (!progress || progress.completed || progress.time <= 0)) continue;
        if (option.id === 'watched' && (!progress || !progress.completed)) continue;
        historyItems.push(entries[h]);
      }
      return historyItems;
    }
    var rows = option.row ? [option.row] : rowsOf();
    var seen = {};
    var items = [];
    var now = Date.now();
    for (var r = 0; r < rows.length; r++) {
      var list = rows[r].items || [];
      for (var c = 0; c < list.length; c++) {
        var item = list[c];
        if (seen[item.id] || item.failed) continue;
        seen[item.id] = true;
        if (option.id === 'live' && !item.live) continue;
        if (option.id === 'videos' && item.broadcastId) continue;
        if (option.id === 'hot' && !item.live && (!item.publishedAt || now - item.publishedAt > 86400000)) continue;
        items.push(item);
      }
    }
    items.sort(function (a, b) {
      return (b.live ? 1 : 0) - (a.live ? 1 : 0) ||
        (a.pending ? 1 : 0) - (b.pending ? 1 : 0) ||
        (option.id === 'hot' ? hotScore(b, now) - hotScore(a, now) : 0) ||
        (b.publishedAt || 0) - (a.publishedAt || 0);
    });
    // Hot, Live and Videos combine every channel; the TV draws each card, so keep the newest 60.
    return option.row ? items : items.slice(0, 60);
  }

  function showToast(msg) {
    var el = document.getElementById('toast');
    if (!msg) {
      el.className = '';
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.className = 'on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 3600);
  }

  function setScreen(name) {
    state.screen = name;
    document.getElementById('app').className = 'screen-' + name;
  }

  function thumbnailImage(item) {
    var channelSrc = item.authorAvatar ? assetUrl(item.authorAvatar) : '';
    var shotSrc = item.thumbnail ? assetUrl(item.thumbnail) : channelSrc || BRAND_SYMBOL;
    var shotClass = item.thumbnail ? 'shot' : channelSrc ? 'shot channel-shot' : 'shot logo-shot';
    return '<img class="' + shotClass + '" alt=""' +
      (item.thumbnail && channelSrc ? ' data-channel-src="' + esc(channelSrc) + '"' : '') + ' src="' + esc(shotSrc) + '">';
  }

  function cardHTML(item, hero, r, c) {
    var historyView = state.historyOpen && state.screen !== 'search';
    var badge = '';
    if (item.live) badge = historyView ? '<span class="badge replay">LIVE STREAM</span>' : '<span class="badge live">LIVE</span>';
    else if (item.pending) badge = '<span class="badge replay">BROADCAST</span>';
    else if (item.replay) badge = '<span class="badge replay">REPLAY</span>';
    var dur = (!item.live && item.durationSec)
      ? '<span class="dur">' + esc(formatDuration(item.durationSec)) + '</span>'
      : '';
    var av = item.authorAvatar ? '<img class="av" alt="" src="' + esc(assetUrl(item.authorAvatar)) + '">' : '';
    var hint = hero ? '<div class="playhint">OK to play</div>' : '';
    var progress = !item.live && window.HelloFavourites ? HelloFavourites.progress(item.id) : null;
    var watched = progress && (progress.completed || progress.time > 0);
    var watchLabel = watched ? (progress.completed ? 'Watched' : Math.round(progress.fraction * 100) + '% watched') : '';
    var progressHTML = watched ? '<div class="watch-status" aria-hidden="true">' + esc(watchLabel) + '</div><div class="watch-progress" aria-hidden="true"><span style="width:' + (progress.fraction * 100) + '%"></span></div>' : '';
    return '<button type="button" class="card' + (hero ? ' hero' : '') + '" data-row="' + r + '" data-col="' + c + '">' +
      (watched ? '<span class="sr-only">' + esc(watchLabel) + '. </span>' : '') +
      '<div class="thumb">' + thumbnailImage(item) + badge + dur + progressHTML + '</div>' +
      '<div class="cap"><div class="ttl">' + esc(item.title) + '</div>' +
      '<div class="sub">' + av + '<span>' + esc(historyView ? (item.authorName ? item.authorName + ' · ' : '') + 'Played ' + timeAgo(item.watchedAt) : metaLine(item)) + '</span></div>' + hint +
      '</div></button>';
  }

  function hideBrokenImages(root) {
    var imgs = root.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].onerror = function () {
        var cls = this.className || '';
        if (cls.indexOf('home-avatar') !== -1 && this.getAttribute('data-fallback') !== '1') {
          this.setAttribute('data-fallback', '1');
          this.src = BRAND_SYMBOL;
          return;
        }
        if (cls.indexOf('shot') !== -1 && this.getAttribute('data-channel-src')) {
          var channelSrc = this.getAttribute('data-channel-src');
          this.removeAttribute('data-channel-src');
          this.className = 'shot channel-shot';
          this.src = channelSrc;
          return;
        }
        if (cls.indexOf('shot') !== -1 && this.getAttribute('data-fallback') !== '1') {
          this.setAttribute('data-fallback', '1');
          this.className = 'shot logo-shot';
          this.src = BRAND_SYMBOL;
          return;
        }
        this.style.visibility = 'hidden';
      };
      if (imgs[i].complete && !imgs[i].naturalWidth) imgs[i].onerror();
    }
  }

  function paintNav() {
    var nav = document.getElementById('nav');
    nav.className = state.zone === 'nav' ? 'expanded' : '';
    if (state.zone === 'nav' && navButtons[state.navIndex] === coffeeButton &&
        (!navPointerFocus || coffeeButton.matches(':hover'))) nav.classList.add('coffee-preview');
    var current = 'home';
    if (state.screen === 'search') current = 'search';
    else if (state.historyOpen) current = 'history';
    for (var i = 0; i < navButtons.length; i++) {
      var cls = 'nav-btn';
      if (navButtons[i].getAttribute('data-nav') === current) cls += ' current';
      if (state.zone === 'nav' && i === state.navIndex) cls += ' focused';
      navButtons[i].className = cls;
    }
  }

  function paintFocus() {
    paintNav();
    var chips = document.querySelectorAll('#homeChips .home-chip');
    for (var p = 0; p < chips.length; p++) {
      chips[p].className = 'home-chip' + (chips[p].getAttribute('data-compact') === '1' ? ' channel-compact' : '') +
        (p === state.browseChipIndex ? ' selected' : '') +
        (state.screen === 'browse' && state.zone === 'homechips' && p === state.browseChipFocus ? ' focused' : '');
      chips[p].setAttribute('aria-pressed', p === state.browseChipIndex ? 'true' : 'false');
    }
    var cards = document.querySelectorAll('#rows .card');
    var cardFocus = state.screen === 'browse' && state.zone === 'rows';
    for (var i = 0; i < cards.length; i++) {
      var cardClass = 'card' + (cardFocus && i === state.browseIndex ? ' focused' : '');
      if (cards[i].className !== cardClass) cards[i].className = cardClass;
    }
    placeRing(document.getElementById('rows'), cardFocus ? cards[state.browseIndex] : null);
    if (state.screen !== 'browse') return;
    if (state.zone === 'homechips' && chips[state.browseChipFocus]) {
      var chip = chips[state.browseChipFocus];
      var strip = document.getElementById('homeChips');
      if (chip.offsetLeft < strip.scrollLeft) strip.scrollLeft = chip.offsetLeft - 8;
      else if (chip.offsetLeft + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = chip.offsetLeft + chip.offsetWidth - strip.clientWidth + 8;
      }
    }
    if (state.zone !== 'rows') return;
    var item = browseItems[state.browseIndex];
    state.focusId = item ? item.id : null;
    paintBackdrop(item);
    var card = cards[state.browseIndex];
    if (!card) return;
    revealCard(document.getElementById('rows'), card);
  }

  function chooseHomeFilter(index) {
    state.browseChipIndex = index;
    state.browseChipFocus = index;
    state.browseIndex = 0;
    state.focusId = null;
    state.animateGrid = true;
    document.getElementById('rows').scrollTop = 0;
    renderBrowse();
  }

  // Background data updates wait for an entrance animation to finish instead of cutting it off.
  function renderBrowseQuietly() {
    var wait = gridSettleAt - Date.now();
    clearTimeout(gridDeferred);
    if (wait > 0) gridDeferred = setTimeout(renderBrowse, wait);
    else renderBrowse();
  }

  function measureHomeTitles() {
    var titles = document.querySelectorAll('#homeChips .channel-compact .chip-title');
    for (var i = 0; i < titles.length; i++) {
      var text = titles[i].querySelector('.chip-title-text');
      titles[i].style.setProperty('--channel-title-width', text.scrollWidth + 'px');
    }
  }

  function paintChannelDrag() {
    var chips = document.querySelectorAll('#homeChips [data-channel]');
    for (var i = 0; i < chips.length; i++) {
      var handle = chips[i].getAttribute('data-channel');
      if (!channelDrag) chips[i].style.width = '';
      chips[i].classList.toggle('dragging', !!channelDrag && handle === channelDrag.handle);
      chips[i].classList.toggle('drop-before', !!channelDrag && handle === channelDrag.target && !channelDrag.after);
      chips[i].classList.toggle('drop-after', !!channelDrag && handle === channelDrag.target && channelDrag.after);
    }
    document.getElementById('homeChips').classList.toggle('reordering', !!channelDrag);
  }

  function clearChannelDragPreview() {
    if (channelDragPreview) channelDragPreview.parentNode.removeChild(channelDragPreview);
    channelDragPreview = null;
  }

  function startChannelDrag(e, btn) {
    var chips = document.querySelectorAll('#homeChips [data-channel]');
    for (var i = 0; i < chips.length; i++) chips[i].style.width = chips[i].offsetWidth + 'px';
    channelDrag = { handle: btn.getAttribute('data-channel'), target: null, after: false };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', channelDrag.handle);
    // Use a small badge, even when the drag starts on a high resolution avatar.
    clearChannelDragPreview();
    channelDragPreview = document.createElement('div');
    channelDragPreview.className = 'channel-drag-preview';
    channelDragPreview.setAttribute('aria-hidden', 'true');
    var avatar = btn.querySelector('.home-avatar');
    if (avatar) channelDragPreview.appendChild(avatar.cloneNode(false));
    var label = document.createElement('span');
    label.textContent = btn.getAttribute('aria-label');
    channelDragPreview.appendChild(label);
    // Keep the preview outside the scaled TV canvas so its size stays readable on PC.
    document.documentElement.appendChild(channelDragPreview);
    e.dataTransfer.setDragImage(channelDragPreview, 20, 22);
    // The browser captures the badge at the end of dragstart.
    setTimeout(clearChannelDragPreview, 0);
    paintChannelDrag();
  }

  function endChannelDrag() {
    clearChannelDragPreview();
    channelDrag = null;
    channelDragClickUntil = Date.now() + 300;
    paintChannelDrag();
    renderBrowseQuietly();
  }

  function dragOverChannels(e) {
    if (!channelDrag || state.screen !== 'browse' || state.historyOpen) return;
    var host = document.getElementById('homeChips');
    var chips = host.querySelectorAll('[data-channel]');
    if (!chips.length) return;
    var first = chips[0].getBoundingClientRect();
    channelDrag.target = null;
    if (e.clientX >= first.left - 6) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var bounds = host.getBoundingClientRect();
      if (e.clientX > bounds.right - 48) host.scrollLeft += 24;
      else if (e.clientX < bounds.left + 48) host.scrollLeft -= 24;
      var target = chips[chips.length - 1];
      for (var i = 0; i < chips.length; i++) {
        if (e.clientX < chips[i].getBoundingClientRect().right + 6) { target = chips[i]; break; }
      }
      var rect = target.getBoundingClientRect();
      var handle = target.getAttribute('data-channel');
      if (handle !== channelDrag.handle) {
        channelDrag.target = handle;
        channelDrag.after = e.clientX >= rect.left + rect.width / 2;
      }
    }
    paintChannelDrag();
  }

  function dropChannel(e) {
    if (!channelDrag) return;
    e.preventDefault();
    var options = homeOptions();
    var selected = options[state.browseChipIndex].id;
    var moved = 'channel:' + channelDrag.handle;
    var data = channelDrag.target && HelloCatalog.reorderFavourite(channelDrag.handle, channelDrag.target, channelDrag.after);
    clearChannelDragPreview();
    channelDrag = null;
    channelDragClickUntil = Date.now() + 300;
    paintChannelDrag();
    if (data) {
      state.data = data;
      options = homeOptions();
      for (var i = 0; i < options.length; i++) {
        if (options[i].id === selected) state.browseChipIndex = i;
        if (options[i].id === moved) state.browseChipFocus = i;
      }
      state.zone = 'homechips';
      showToast('Channel order saved');
    }
    renderBrowse();
  }

  function renderBrowse() {
    // Keep the dragged DOM node alive while background broadcast details arrive.
    if (channelDrag) return;
    var options = homeOptions();
    if (state.browseChipIndex >= options.length) state.browseChipIndex = 0;
    state.browseChipFocus = Math.min(state.browseChipFocus, options.length - 1);
    var option = options[state.browseChipIndex];
    var items = homeItems();
    browseItems = items;
    var waitingHome = !state.historyOpen && !state.data && state.loading;
    var title = state.historyOpen ? 'History' : option.id === 'hot' ? 'Hot right now' : option.title;
    clearTimeout(gridDeferred);
    if (title !== shownTitle) {
      if (shownTitle !== null) {
        replay(document.getElementById('homeTitle'), 'swap');
        replay(document.getElementById('homeSummary'), 'swap');
      }
      shownTitle = title;
      document.getElementById('homeTitle').textContent = title;
    }
    document.getElementById('homeSummary').textContent = waitingHome ? 'Loading videos and broadcasts from your channels' : state.historyOpen ?
      items.length + (items.length === 1 ? ' played video or broadcast' : ' played videos and broadcasts') + ' · Most recently played first' : option.id === 'hot' ?
      'Live now and popular in your channels over the past 24 hours' : items.length ?
      items.length + ' videos and broadcasts' + (option.row ? ' from this channel' : ' from your channels') :
      'Recent videos and broadcasts from your channels';
    var html = '';
    var liveNow = false;
    var liveRows = rowsOf();
    for (var lr = 0; lr < liveRows.length; lr++) {
      var liveItems = liveRows[lr].items || [];
      for (var li = 0; li < liveItems.length; li++) if (liveItems[li].live && !liveItems[li].failed) liveNow = true;
    }
    for (var p = 0; p < options.length; p++) {
      var compact = options.length - 3 > 4 && !!options[p].row;
      html += '<button type="button" class="home-chip" data-i="' + p + '" data-compact="' + (compact ? '1' : '0') +
        (options[p].row ? '" draggable="true" data-channel="' + esc(options[p].row.id) + '" title="Drag to rearrange channel"' : '"') +
        ' aria-label="' + esc(options[p].title) + '">' +
        (options[p].id === 'live' ? '<i class="live-dot' + (liveNow ? ' on' : '') + '" aria-hidden="true"></i>' : '') +
        (options[p].avatar || compact ? '<img class="home-avatar" draggable="false" alt="" src="' + esc(assetUrl(options[p].avatar || BRAND_SYMBOL)) + '">' : '') +
        '<span class="chip-title">' + (compact ? '<span class="chip-title-text">' : '') + esc(options[p].title) +
        (compact ? '</span>' : '') + '</span></button>';
    }
    var chipHost = document.getElementById('homeChips');
    chipHost.ondragover = dragOverChannels;
    chipHost.ondragleave = function (e) {
      if (channelDrag && !chipHost.contains(e.relatedTarget)) { channelDrag.target = null; paintChannelDrag(); }
    };
    chipHost.ondrop = dropChannel;
    if (homeChipsPainted !== html) {
      homeChipsPainted = html;
      chipHost.innerHTML = html;
      hideBrokenImages(chipHost);
      renderEmoji(chipHost);
      measureHomeTitles();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureHomeTitles);
      var chips = chipHost.querySelectorAll('.home-chip');
      for (var n = 0; n < chips.length; n++) {
        (function (btn, index) {
          btn.addEventListener('transitionend', function (e) {
            if (e.propertyName === 'max-width' && state.zone === 'homechips' && state.browseChipFocus === index) paintFocus();
          });
          btn.onmousemove = function () {
            if (state.screen !== 'browse' || channelDrag) return;
            state.zone = 'homechips';
            state.browseChipFocus = index;
            paintFocus();
          };
          btn.onclick = function () {
            if (channelDrag || Date.now() < channelDragClickUntil) return;
            state.zone = 'homechips';
            chooseHomeFilter(index);
          };
          if (btn.hasAttribute('data-channel')) {
            btn.ondragstart = function (e) {
              startChannelDrag(e, btn);
            };
            btn.ondragend = endChannelDrag;
          }
        })(chips[n], n);
      }
    }
    renderEmoji(document.getElementById('homeTitle'));
    html = '';
    for (var c = 0; c < items.length; c++) html += cardHTML(items[c], false, Math.floor(c / HOME_COLS), c % HOME_COLS);
    if (!html) {
      var message = waitingHome ? 'Loading your channels...' : state.historyOpen ? (option.id === 'in-progress' ? 'No videos in progress.' : option.id === 'watched' ? 'No completed videos yet.' : 'Your history is empty.') : option.id === 'hot' ? 'Nothing hot right now.' : option.id === 'live' ? 'No live streams right now.' : 'No recent videos found.';
      html = '<div class="message"><strong>' + message + '</strong><span>' +
        (waitingHome ? 'Your saved History is available while these load.' : state.historyOpen ? 'Videos appear here when playback starts. Choose Home or Search to watch something.' : option.id === 'hot' ? 'Choose Videos for clips, or a channel for all its videos and replays.' :
          option.id === 'live' ? 'Choose Hot to watch popular recent videos and replays, or choose a channel.' :
          'Choose another channel, or use Search to find more.') + '</span></div>';
    }
    var host = document.getElementById('rows');
    var animate = state.animateGrid && prefs.motion;
    state.animateGrid = false;
    if (animate || html !== rowsPainted || !host.querySelector('.grid')) {
      rowsPainted = html;
      host.innerHTML = gridHTML(html, animate);
      if (animate) gridSettleAt = settleGrid(host);
      hideBrokenImages(host);
      renderEmoji(host);
    }
    var cards = host.querySelectorAll('.card');
    for (var k = 0; k < cards.length; k++) {
      (function (card, index) {
        card.onmousemove = function () {
          if (state.screen !== 'browse' || (state.zone === 'rows' && state.browseIndex === index)) return;
          state.zone = 'rows';
          state.browseIndex = index;
          withPointer(paintFocus);
        };
        card.onclick = function () {
          state.zone = 'rows';
          state.browseIndex = index;
          withPointer(paintFocus);
          playItem(items, index);
        };
      })(cards[k], k);
    }
    if (state.focusId) {
      for (var f = 0; f < items.length; f++) if (items[f].id === state.focusId) state.browseIndex = f;
    }
    state.browseIndex = Math.max(0, Math.min(state.browseIndex, items.length - 1));
    if (!items.length && state.zone === 'rows') state.zone = 'homechips';
    paintBackdrop(items[state.browseIndex]);
    paintFocus();
  }

  function filtered() {
    if (state.chipIndex === 3) return state.searchProfiles;
    if (state.chipIndex === 0) return state.searchItems;
    return state.searchItems.filter(function (item) {
      return state.chipIndex === 1 ? item.live : !item.live;
    });
  }

  function resultId(item) {
    return item && (item.id || item.handle);
  }

  function paintSearchFocus() {
    paintNav();
    var keys = document.querySelectorAll('#keys .key');
    for (var i = 0; i < keys.length; i++) {
      var on = state.zone === 'keys' &&
        keys[i].getAttribute('data-r') === String(state.keyRow) &&
        keys[i].getAttribute('data-c') === String(state.keyCol);
      keys[i].className = 'key' + (keys[i].getAttribute('data-wide') ? ' wide' : '') + (on ? ' focused' : '');
    }
    var chips = document.querySelectorAll('#chips .chip');
    for (var p = 0; p < chips.length; p++) {
      var selected = p === state.chipIndex;
      chips[p].className = 'chip' + (selected ? ' selected' : '') +
        (selected && state.zone === 'chips' ? ' focused' : '');
      chips[p].setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    var cards = document.querySelectorAll('#results .result');
    for (var c = 0; c < cards.length; c++) {
      var resultClass = cards[c].className.replace(' focused', '') + (state.zone === 'results' && c === state.gridIndex ? ' focused' : '');
      if (cards[c].className !== resultClass) cards[c].className = resultClass;
    }
    var card = cards[state.gridIndex];
    placeRing(document.getElementById('results'), state.zone === 'results' ? card : null);
    state.searchFocusId = resultId(filtered()[state.gridIndex]);
    if (card && state.zone === 'results') revealCard(document.getElementById('results'), card);
  }

  function paintQuery() {
    var query = document.getElementById('query');
    query.className = state.searchQuery ? '' : 'empty';
    if (state.searchQuery) query.textContent = state.searchQuery;
    else query.innerHTML = '<span class="ghost">Search channels</span>';
  }

  function paintSearchKeys() {
    if (searchPainted) return;
    var keysHtml = '';
    for (var r = 0; r < KEYBOARD.length; r++) {
      keysHtml += '<div class="key-row">';
      for (var c = 0; c < KEYBOARD[r].length; c++) {
        var label = KEYBOARD[r][c];
        var wide = (label === 'space' || label === 'clear') ? ' data-wide="1"' : '';
        var shown = label === '⌫' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4L1 12l6 8h15V4H7zm1 2h12v12H8l-4.5-6L8 6zm3 2l-1.4 1.4 2.6 2.6-2.6 2.6L11 16l2.6-2.6L16.2 16l1.4-1.4-2.6-2.6 2.6-2.6L16.2 8l-2.6 2.6L11 8z"/></svg>' : esc(label);
        keysHtml += '<button type="button" class="key" data-r="' + r + '" data-c="' + c + '"' + wide +
          (label === '⌫' ? ' aria-label="Delete character"' : '') + '>' + shown + '</button>';
      }
      keysHtml += '</div>';
    }
    document.getElementById('keys').innerHTML = keysHtml;
    var keyButtons = document.querySelectorAll('#keys .key');
    for (var k = 0; k < keyButtons.length; k++) {
      (function (btn) {
        function focusKey() {
          state.zone = 'keys';
          state.keyRow = parseInt(btn.getAttribute('data-r'), 10);
          state.keyCol = parseInt(btn.getAttribute('data-c'), 10);
          paintSearchFocus();
        }
        btn.onmousemove = focusKey;
        btn.onclick = function () {
          focusKey();
          pressKey(KEYBOARD[state.keyRow][state.keyCol]);
        };
      })(keyButtons[k]);
    }
    var chipsHtml = '';
    for (var n = 0; n < CHIPS.length; n++) {
      chipsHtml += '<button type="button" class="chip" data-i="' + n + '"><span class="chip-label">' + CHIPS[n] + '</span><span class="chip-count"></span></button>';
    }
    document.getElementById('chips').innerHTML = chipsHtml;
    var chips = document.querySelectorAll('#chips .chip');
    for (var p = 0; p < chips.length; p++) {
      (function (btn, index) {
        btn.onmousemove = function () {
          state.zone = 'chips';
          selectChip(index);
        };
        btn.onclick = function () {
          state.zone = 'chips';
          selectChip(index);
        };
      })(chips[p], p);
    }
    searchPainted = true;
  }

  function channelHTML(profile) {
    var added = window.HelloCatalog && HelloCatalog.isFavourite(profile.handle);
    var avatar = profile.avatar || BRAND_SYMBOL;
    return '<button type="button" class="channel result">' +
      '<img class="channel-avatar" alt="" src="' + esc(avatar) + '">' +
      '<span class="pname">' + esc(profile.name || profile.handle) + '</span>' +
      '<span class="phandle">@' + esc(profile.handle) + '</span>' +
      '<span class="pact">' + (added ? 'OK to remove' : 'OK to add') + '</span></button>';
  }

  function paintSearchResults(focusId) {
    var list = filtered();
    if (focusId) {
      for (var f = 0; f < list.length; f++) {
        if (resultId(list[f]) === focusId) {
          state.gridIndex = f;
          break;
        }
      }
    }
    state.gridIndex = Math.max(0, Math.min(state.gridIndex, list.length - 1));
    if (!list.length && state.zone === 'results') state.zone = 'chips';
    var html = '';
    var status = document.getElementById('searchStatus');
    status.className = state.searching ? 'loading' : '';
    if (state.searching) status.textContent = state.searchProfiles.length ?
      'Loading videos · ' + state.searchCompleted + ' of ' + state.searchTotal + ' channels' : 'Finding channels…';
    else if (state.searchError) status.textContent = state.searchError;
    else status.textContent = state.searchProfiles.length ? '' : 'Search by channel name or @handle';
    var live = 0;
    for (var l = 0; l < state.searchItems.length; l++) if (state.searchItems[l].live) live++;
    var counts = state.searchProfiles.length ?
      [state.searchItems.length, live, state.searchItems.length - live, state.searchProfiles.length] : [];
    var countEls = document.querySelectorAll('#chips .chip-count');
    for (var n = 0; n < countEls.length; n++) {
      countEls[n].textContent = counts.length ? String(counts[n]) : '';
      countEls[n].style.display = counts.length ? '' : 'none';
    }
    for (var c = 0; c < list.length; c++) {
      html += state.chipIndex === 3 ? channelHTML(list[c]) :
        cardHTML(list[c], false, Math.floor(c / COLS), c % COLS).replace('class="card', 'class="result card');
    }
    if (!html) {
      var q = state.searchQuery.replace(/^\s+|\s+$/g, '').replace(/^@+/, '');
      var hint = 'Search a channel to see its recent videos and live streams.';
      if (q.length === 1) hint = 'Type at least two characters to search.';
      else if (q.length >= 2) {
        if (state.searching) hint = state.searchProfiles.length ?
          'Channels found. Videos are loading. Choose Channels to browse or add them now.' : 'Finding channels matching “' + q + '”…';
        else if (state.searchError) hint = state.searchError;
        else if (!state.searchProfiles.length) hint = 'No matching channels. Try another name or @handle.';
        else if (state.chipIndex === 1) hint = 'No live streams found in these channels’ recent posts.';
        else hint = 'No videos in these channels’ recent posts. Try Channels to add one to Home.';
      }
      html = '<div class="hint">' + esc(hint) + '</div>';
    }
    var host = document.getElementById('results');
    var animate = prefs.motion && (state.animateResults || (list.length > 0 && state.resultsGen !== state.searchGen));
    state.animateResults = false;
    if (list.length) state.resultsGen = state.searchGen;
    clearTimeout(resultsDeferred);
    host.setAttribute('aria-busy', state.searching ? 'true' : 'false');
    host.innerHTML = gridHTML(html, animate);
    if (animate) resultsSettleAt = settleGrid(host);
    renderEmoji(host);
    hideBrokenImages(host);
    var cards = host.querySelectorAll('.result');
    for (var n = 0; n < cards.length; n++) {
      (function (card, index) {
        card.onmousemove = function () {
          if (state.zone === 'results' && state.gridIndex === index) return;
          state.zone = 'results';
          state.gridIndex = index;
          withPointer(paintSearchFocus);
        };
        card.onclick = function () {
          state.zone = 'results';
          state.gridIndex = index;
          withPointer(paintSearchFocus);
          activateResult();
        };
      })(cards[n], n);
    }
    paintSearchFocus();
  }

  // Progressive search updates wait for the entrance animation, like Home.
  function paintSearchResultsQuietly() {
    var wait = resultsSettleAt - Date.now();
    clearTimeout(resultsDeferred);
    if (wait > 0) resultsDeferred = setTimeout(function () { if (state.screen === 'search') paintSearchResults(state.searchFocusId); }, wait);
    else paintSearchResults(state.searchFocusId);
  }

  function selectChip(index) {
    if (state.chipIndex === index) {
      paintSearchFocus();
      return;
    }
    state.chipIndex = index;
    state.gridIndex = 0;
    state.animateResults = true;
    document.getElementById('results').scrollTop = 0;
    paintSearchResults();
  }

  function paintSearch() {
    paintQuery();
    paintSearchKeys();
    paintSearchResults();
  }

  function resolveSearchBroadcasts(gen) {
    for (var i = 0; i < state.searchItems.length && state.searchResolveCount < 6; i++) {
      var item = state.searchItems[i];
      if (!item.pending || state.searchResolveIds[item.id]) continue;
      state.searchResolveIds[item.id] = true;
      state.searchResolveCount += 1;
      state.searchResolveQueue.push(item);
    }
    function pump() {
      if (gen !== state.searchGen) return;
      while (state.searchResolveActive < 2 && state.searchResolveQueue.length) {
        resolveOne(state.searchResolveQueue.shift());
      }
    }
    function resolveOne(item) {
      state.searchResolveActive += 1;
      HelloCatalog.resolve(item, function (err) {
        if (gen !== state.searchGen) return;
        var focusId = state.searchFocusId;
        state.searchResolveActive -= 1;
        if (err) { item.pending = false; item.failed = true; item.replay = false; }
        state.searchItems.sort(function (a, b) {
          return (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.publishedAt || 0) - (a.publishedAt || 0);
        });
        if (state.screen === 'search') paintSearchResultsQuietly();
        else if (focusId) {
          var list = filtered();
          for (var f = 0; f < list.length; f++) if (resultId(list[f]) === focusId) state.gridIndex = f;
        }
        pump();
      });
    }
    pump();
  }

  function runSearch() {
    var q = state.searchQuery.replace(/^\s+|\s+$/g, '');
    var gen = state.searchGen;
    if (q.replace(/^@+/, '').length < 2) return;
    if (!window.HelloCatalog || !HelloCatalog.search) {
      state.searching = false;
      state.searchError = "Search couldn't load. Reopen the app and try again.";
      if (state.screen === 'search') paintSearchResults();
      return;
    }
    HelloCatalog.search(q, function (err, data) {
      if (gen !== state.searchGen) return;
      data = data || {};
      state.searchProfiles = data.profiles || [];
      state.searchItems = data.items || [];
      state.searching = false;
      state.searchError = err ? "Couldn't load recent videos. Check your connection and try again." : '';
      if (err || (data.errors && data.errors.length)) showToast("Some channels couldn't load. Try again shortly.");
      if (state.screen === 'search') paintSearchResultsQuietly();
      resolveSearchBroadcasts(gen);
    }, function (data) {
      if (gen !== state.searchGen) return;
      var focusId = state.searchFocusId;
      state.searchProfiles = data.profiles || [];
      state.searchItems = data.items || [];
      state.searchCompleted = data.completed || 0;
      state.searchTotal = data.total || 0;
      state.searchFocusId = focusId;
      if (state.screen === 'search') paintSearchResultsQuietly();
      resolveSearchBroadcasts(gen);
    });
  }

  function scheduleSearch() {
    clearTimeout(state.searchTimer);
    // Invalidate in-flight callbacks as soon as the query changes, before the debounce.
    state.searchGen += 1;
    state.searchProfiles = [];
    state.searchItems = [];
    state.searchFocusId = null;
    state.searchError = '';
    state.searchCompleted = 0;
    state.searchTotal = 0;
    state.searchResolveIds = {};
    state.searchResolveQueue = [];
    state.searchResolveCount = 0;
    state.searchResolveActive = 0;
    state.gridIndex = 0;
    state.searching = state.searchQuery.replace(/^\s+|\s+$/g, '').replace(/^@+/, '').length >= 2;
    document.getElementById('results').scrollTop = 0;
    paintSearchResults();
    if (state.searching) state.searchTimer = setTimeout(runSearch, 700);
  }

  function toggleFocusedChannel() {
    var profile = filtered()[state.gridIndex];
    if (!profile || !window.HelloCatalog) return;
    var action = HelloCatalog.toggleFavourite(profile);
    if (action === 'last') showToast('Keep at least one channel');
    else if (action === 'added' || action === 'removed') {
      loadHome(true);
      showToast((action === 'added' ? 'Added ' : 'Removed ') + (profile.name || profile.handle));
    }
    paintSearchResults();
  }

  function activateResult() {
    if (state.chipIndex === 3) toggleFocusedChannel();
    else playItem(filtered(), state.gridIndex);
  }

  function pressKey(key) {
    if (key === '⌫') state.searchQuery = state.searchQuery.slice(0, -1);
    else if (key === 'clear') state.searchQuery = '';
    else if (state.searchQuery.length < 64) state.searchQuery += key === 'space' ? ' ' : key;
    paintQuery();
    scheduleSearch();
  }

  function openSearch() {
    state.playGen += 1;
    state.opening = false;
    if (state.historyOpen) { leaveHistory(); renderBrowse(); }
    setScreen('search');
    state.zone = 'keys';
    state.keyRow = 0;
    state.keyCol = 0;
    state.navIndex = 1;
    paintSearch();
  }

  function applyData(data) {
    var first = !state.data;
    state.data = data;
    if (window.HelloFavourites) {
      var rows = rowsOf();
      for (var r = 0; r < rows.length; r++) {
        var items = rows[r].items || [];
        for (var i = 0; i < items.length; i++) HelloFavourites.remember(items[i], false);
      }
    }
    if (first) {
      state.animateGrid = true;
      renderBrowse();
    } else renderBrowseQuietly();
    if (state.screen === 'search') paintSearchResults();
  }

  function loadHome(force) {
    if (state.loading && !force) return;
    state.loading = true;
    if (force) showToast('Refreshing');
    if (!window.HelloCatalog) {
      state.loading = false;
      showToast("Couldn't load videos");
      return;
    }
    HelloCatalog.load(!!force, function (err, data) {
      state.loading = false;
      if (err || !data) {
        if (!state.data && !state.historyOpen) {
          document.getElementById('rows').innerHTML = '<div class="message">No videos yet.<br>Check the internet connection, then press Refresh.</div>';
          paintNav();
        }
        showToast("Couldn't load videos");
        return;
      }
      var first = !state.data;
      applyData(data);
      if (first && state.screen !== 'player' && state.screen !== 'search' && !state.historyOpen) {
        setScreen('browse');
        state.zone = 'rows';
        state.browseIndex = 0;
        paintFocus();
      }
      if (force && data.errors && data.errors.length) showToast(data.errors[0]);
    }, function (data) {
      if (data) applyData(data);
    });
  }

  function isTv() {
    var ua = navigator.userAgent || '';
    if (window.webOS) return true;
    return /Web0S|WebAppManager|SmartTV|LG Browser/i.test(ua);
  }

  function stopVideo(video) {
    hideBufferingDetails();
    state.downloadFrag = null;
    if (state.transcriber) { state.transcriber.stop(); state.transcriber = null; }
    clearTimeout(state.recoveryTimer);
    state.mp4FrameRate = null;
    state.hlsFrameRates = {};
    if (state.hls) {
      var hls = state.hls;
      state.hls = null;
      hls.destroy();
    }
    try { video.pause(); } catch (e) {}
    while (video.firstChild) video.removeChild(video.firstChild);
    video.removeAttribute('src');
    try { video.load(); } catch (e2) {}
  }

  function showControls(hold) {
    state.overlayDismissed = false;
    var chrome = document.getElementById('chrome');
    chrome.className = 'on';
    clearTimeout(state.controlsTimer);
    var video = document.getElementById('video');
    if (hold || video.paused || playerMenuOpen() || state.playerZone !== 'timeline' || state.recoveryBusy) return;
    state.controlsTimer = setTimeout(function () {
      if (!video.paused && state.screen === 'player') chrome.className = 'hide';
    }, 4000);
  }

  function flashIcon(kind) {
    var el = document.getElementById('centerIcon');
    el.className = 'show ' + kind;
    clearTimeout(state.iconTimer);
    state.iconTimer = setTimeout(function () { el.className = kind; }, 700);
  }

  function flashSeek(text) {
    var el = document.getElementById('seekPop');
    el.textContent = text;
    el.className = 'show';
    clearTimeout(state.seekTimer);
    state.seekTimer = setTimeout(function () { el.className = ''; }, 700);
  }

  function paintProgress() {
    var video = document.getElementById('video');
    var item = state.playing;
    if (!item) return;
    if (item.live || !isFinite(video.duration) || video.duration <= 0) return;
    var pct = (100 * video.currentTime / video.duration);
    document.getElementById('played').style.width = pct + '%';
    document.getElementById('knob').style.left = pct + '%';
    document.getElementById('tcur').textContent = formatDuration(video.currentTime);
    document.getElementById('timeline').setAttribute('aria-valuenow', Math.round(video.currentTime));
    document.getElementById('timeline').setAttribute('aria-valuemax', Math.round(video.duration));
    document.getElementById('tend').textContent = formatDuration(video.duration);
    var buffered = video.buffered;
    if (buffered && buffered.length) {
      var end = buffered.end(buffered.length - 1);
      document.getElementById('buffered').style.width = (100 * end / video.duration) + '%';
    }
  }

  function playItem(items, index) {
    if (!items[index] || state.opening) return;
    openQueueItem({ items: items.slice(), history: state.historyOpen && state.screen === 'browse' }, index, false);
  }

  function openQueueItem(queue, index, advance) {
    if (state.opening) return;
    state.opening = true;
    var gen = ++state.playGen;

    function open() {
      if (gen !== state.playGen) return;
      while (advance && queue.items[index] && queue.items[index].failed) index += 1;
      var item = queue.items[index];
      if (!item) {
        state.opening = false;
        showToast('No more available videos');
        return;
      }

      function ready(resolved, message) {
        if (gen !== state.playGen) return;
        if (resolved && resolved.playback && resolved.playback.url) {
          state.opening = false;
          queue.index = index;
          state.queue = queue;
          showToast('');
          startPlayback(resolved);
        } else if (advance) {
          index += 1;
          setTimeout(open, 0);
        } else {
          state.opening = false;
          showToast(message);
        }
      }

      if (queue.history && window.HelloCatalog) {
        showToast('Opening video');
        HelloCatalog.restore(item, function (err, restored) {
          ready(err ? null : restored, 'This video is unavailable. It remains in History.');
        });
        return;
      }
      if (item.broadcastId && item.playbackFailed) {
        item.playback = null;
        item.playbackFailed = false;
      }
      if (item.playback && item.playback.url) ready(item);
      else if (item.broadcastId && window.HelloCatalog) {
        showToast('Opening broadcast');
        HelloCatalog.resolve(item, function (err) { ready(err ? null : item, "This broadcast didn't load"); });
      } else ready(null, "This video didn't play");
    }
    open();
  }

  function closeFilmstrip() {
    if (state.filmstripIndex < 0) return;
    state.filmstripIndex = -1;
    var strip = document.getElementById('filmstrip');
    strip.hidden = true;
    strip.innerHTML = '';
    strip.parentNode.classList.remove('filmstrip-open');
    document.getElementById('captions').classList.remove('above-filmstrip');
  }

  function dismissFilmstrip() {
    closeFilmstrip();
    state.playerZone = 'timeline';
    paintPlayerActions();
    showControls(false);
  }

  function selectFilmstripItem(index) {
    if (index === state.queue.index) dismissFilmstrip();
    else openQueueItem(state.queue, index, false);
  }

  function focusFilmstrip(index) {
    var queue = state.queue;
    state.filmstripIndex = Math.max(0, Math.min(queue.items.length - 1, index));
    state.playerZone = 'filmstrip';
    var strip = document.getElementById('filmstrip');
    if (!strip.querySelector('[data-index="' + state.filmstripIndex + '"]')) {
      var visible = 6;
      var first = Math.max(0, Math.min(state.filmstripIndex - 2, queue.items.length - visible));
      var end = Math.min(queue.items.length, first + visible);
      var html = '';
      for (var i = first; i < end; i++) {
        var item = queue.items[i];
        var current = i === queue.index;
        var status = current ? 'Now playing' : i === queue.index + 1 ? 'Up next' : i === queue.index - 1 ? 'Previous' : '';
        html += '<button type="button" class="filmstrip-card" data-index="' + i + '"' +
          (current ? ' aria-current="true"' : '') + '><span class="filmstrip-status">' + status + '</span>' +
          '<span class="thumb">' + thumbnailImage(item) + (item.live ? '<span class="badge live">LIVE</span>' : '') +
          '</span><span class="filmstrip-title">' + esc(item.title) + '</span></button>';
      }
      strip.innerHTML = html;
      hideBrokenImages(strip);
      renderEmoji(strip);
      var cards = strip.querySelectorAll('.filmstrip-card');
      for (var c = 0; c < cards.length; c++) {
        cards[c].onmouseenter = function () { if (!playerMenuOpen()) focusFilmstrip(+this.getAttribute('data-index')); };
        cards[c].onclick = function () { selectFilmstripItem(+this.getAttribute('data-index')); };
      }
    }
    strip.hidden = false;
    strip.parentNode.classList.add('filmstrip-open');
    document.getElementById('captions').classList.add('above-filmstrip');
    paintPlayerActions();
    showControls(true);
  }

  function toggleStats() {
    state.statsOn = !state.statsOn;
    clearInterval(state.statsTimer);
    document.getElementById('statsPanel').className = state.statsOn ? 'on' : '';
    if (state.statsOn) {
      // hls.js streams report their own downloads; a plain file is measured directly.
      if (window.HelloNetwork) HelloNetwork.start(
        function () { return state.playing && !state.hls ? mediaUrl(state.playing) : ''; },
        function (url, bytes) {
          var item = state.playing;
          if (window.HelloSps && item && !state.hls && item.playback.type === 'mp4' &&
              state.mp4FrameRate === null && url === mediaUrl(item)) state.mp4FrameRate = HelloSps.frameRate(bytes);
        }
      );
      paintStats();
      state.statsTimer = setInterval(paintStats, 1000);
    } else if (window.HelloNetwork) HelloNetwork.stop();
  }

  function hideBufferingDetails() {
    clearInterval(state.bufferingTimer);
    state.bufferingTimer = null;
    document.getElementById('bufferingDetails').style.display = 'none';
  }

  function paintBufferingDetails() {
    if (!state.playing || state.screen !== 'player' || !state.hasPlayed || state.wantPaused || state.recoveryFailed) {
      hideBufferingDetails();
      return;
    }
    var frag = state.downloadFrag;
    var reading = state.hls && window.HelloNetwork && frag ? HelloNetwork.transfer(frag.stats, performance.now()) : null;
    var quality = state.hls && frag ? state.hls.levels[frag.level] : null;
    if (!quality) {
      var choices = playbackQualities();
      for (var i = 0; i < choices.length; i++) if (choices[i].url === state.playing.playback.url) quality = choices[i];
    }
    var bitrate = quality && quality.bitrate > 0 ? quality.bitrate / 1000000 : 0;
    var downloading = frag && frag.stats && !frag.stats.aborted && frag.stats.loading && !frag.stats.loading.end;
    var speed = reading ? reading.mbps.toFixed(1) + ' Mbps' + (reading.active ? '' : ' (last segment)') :
      (downloading ? 'measuring…' : 'unavailable');
    document.getElementById('bufferingRates').textContent = 'Download ' + speed + ' · Stream bitrate ' +
      (bitrate ? bitrate.toFixed(1) + ' Mbps' : 'unavailable');
    document.getElementById('bufferingReason').textContent = reading && bitrate && reading.mbps < bitrate ?
      (reading.active ? 'Download is below the stream bitrate' : 'The last segment downloaded below the stream bitrate') : 'Refilling playback buffer';
    document.getElementById('bufferingDetails').style.display = 'block';
  }

  function saveResume(force) {
    var item = state.playing;
    var video = document.getElementById('video');
    if (!item || !state.hasPlayed || item.live || video.readyState < 1 || state.restoreTime !== null || !window.HelloFavourites) return;
    if (!force && Date.now() - state.lastPositionSave < 5000) return;
    state.lastPositionSave = Date.now();
    HelloFavourites.savePosition(item.id, video.currentTime, video.duration);
  }

  function paintPost() {
    var item = state.playing;
    if (!item || !state.postOpen) return;
    var html = '<div class="post-heading"><span class="panel-title">' + esc(item.authorName || 'Post') + '</span>' + panelClose('postClose') + '</div>' +
      '<div class="post-tabs"><button type="button" id="postTextTab" class="post-tab' + (state.postTab === 0 ? ' selected' : '') + '">Post text</button>' +
      '<button type="button" id="postCommentsTab" class="post-tab' + (state.postTab === 1 ? ' selected' : '') + '">Comments' +
      (item.replyCount !== null ? ' · ' + esc(item.replyCount) : '') + '</button>' +
      (item.broadcastId ? '<button type="button" id="postChatTab" class="post-tab' + (state.postTab === 2 ? ' selected' : '') + '">Broadcast chat</button>' : '') + '</div><div id="postBody">';
    if (state.postTab === 0) html += '<div class="post-text">' + esc(item.postText || item.title || 'No post text available.') + '</div>';
    else if (state.postTab === 2) {
      var info = state.broadcastInfo;
      var messages = info ? info.messages : [];
      html += '<div class="post-note">' + (info && info.ended ? 'Broadcast ended · Chat history' : 'Live chat · Updates automatically') + '</div>';
      for (var m = 0; m < messages.length; m++) {
        html += '<div class="reply"><div class="reply-author">' + esc(messages[m].name) +
          (messages[m].handle ? ' <span>@' + esc(messages[m].handle) + '</span>' : '') + '</div><div class="post-text">' + esc(messages[m].text) + '</div></div>';
      }
      if (info && info.chatState === 'off') html += '<div class="post-note">Chat is turned off for this broadcast.</div>';
      else if (info && info.chatState === 'unavailable') html += '<div class="post-note">Chat history isn’t available for this broadcast.</div>';
      else if (info && info.chatState === 'error') html += '<div class="post-note">Chat could not connect. Press OK to retry.</div><button type="button" id="chatRetry">Try again</button>';
      else if (!info || info.chatState === 'loading' || info.chatState === 'idle') html += '<div class="post-note" role="status">Loading broadcast chat…</div>';
      else if (!messages.length) html += '<div class="post-note">' + (info.ended ? 'No chat messages were returned for this broadcast.' : 'No chat messages yet.') + '</div>';
    } else {
      for (var i = 0; i < state.comments.length; i++) {
        var reply = state.comments[i];
        var author = reply.author || {};
        html += '<div class="reply"><div class="reply-author">' + esc(author.name || author.screen_name || 'Reply') +
          (author.screen_name ? ' <span>@' + esc(author.screen_name) + '</span>' : '') + '</div><div class="post-text">' + esc(reply.text || '') + '</div></div>';
      }
      if (state.commentsLoading) html += '<div class="post-note" role="status">Loading comments…</div>';
      else if (state.commentsError) html += '<div class="post-note">The public source could not load comments.</div><button type="button" id="commentsMore">Try again</button>';
      else if (!state.comments.length && state.commentsLoaded) html += '<div class="post-note">No replies returned by the source.</div>';
      else if (state.commentsCursor) html += '<button type="button" id="commentsMore">More comments</button>';
    }
    html += '</div>';
    var host = document.getElementById('postPanel');
    var body = document.getElementById('postBody');
    var scroll = body ? body.scrollTop : 0;
    var follow = state.postTab === 2 && (!body || body.scrollHeight - body.clientHeight - scroll < 80);
    host.innerHTML = html;
    renderEmoji(host);
    host.className = 'on';
    body = document.getElementById('postBody');
    body.scrollTop = follow ? body.scrollHeight : scroll;
    document.getElementById('postClose').onclick = function (e) { e.stopPropagation(); togglePost(); };
    document.getElementById('postTextTab').onclick = function (e) { e.stopPropagation(); setPostTab(0); };
    document.getElementById('postCommentsTab').onclick = function (e) { e.stopPropagation(); setPostTab(1); };
    var chatTab = document.getElementById('postChatTab');
    if (chatTab) chatTab.onclick = function (e) { e.stopPropagation(); setPostTab(2); };
    var retry = document.getElementById('chatRetry');
    if (retry) retry.onclick = function (e) { e.stopPropagation(); if (state.broadcast) state.broadcast.retry(); };
    var more = document.getElementById('commentsMore');
    if (more) more.onclick = function (e) { e.stopPropagation(); loadComments(state.commentsCursor); };
  }

  function loadComments(cursor) {
    var item = state.playing;
    if (!item || state.commentsLoading) return;
    state.commentsLoading = true;
    state.commentsError = false;
    paintPost();
    var gen = state.postGen;
    HelloCatalog.conversation(item.postId, cursor, function (error, data) {
      if (gen !== state.postGen || state.playing !== item) return;
      state.commentsLoading = false;
      state.commentsError = !!error;
      if (!error) {
        state.commentsLoaded = true;
        var replies = data.replies || [];
        var seen = {};
        for (var j = 0; j < state.comments.length; j++) seen[state.comments[j].id] = true;
        for (var i = 0; i < replies.length; i++) if (replies[i].text && !seen[replies[i].id]) { state.comments.push(replies[i]); seen[replies[i].id] = true; }
        state.commentsCursor = data.cursor && data.cursor.bottom;
        if (data.status && data.status.text) item.postText = data.status.text;
      }
      paintPost();
    });
  }

  function setPostTab(index) {
    state.postTab = index;
    if (state.broadcast) state.broadcast.setChatEnabled(index === 2 && state.postOpen);
    paintPost();
    var body = document.getElementById('postBody');
    body.scrollTop = index === 2 ? body.scrollHeight : 0;
    if (index === 1 && !state.commentsLoaded) loadComments(null);
  }

  function togglePost() {
    if (!state.postOpen && state.qualityOpen) closeQualityMenu();
    if (!state.postOpen && state.captionsOpen) closeCaptionsMenu();
    closeFilmstrip();
    state.postOpen = !state.postOpen;
    state.playerZone = 'controls';
    state.playerAction = 2;
    paintPlayerActions();
    if (state.postOpen) {
      if (state.broadcast) state.broadcast.setChatEnabled(state.postTab === 2);
      paintPost();
      if (state.postTab === 1 && !state.commentsLoaded) loadComments(null);
    } else {
      if (state.broadcast) state.broadcast.setChatEnabled(false);
      state.postGen += 1;
      state.commentsLoading = false;
      document.getElementById('postPanel').className = '';
    }
    showControls(false);
  }

  function paintStats() {
    if (!state.statsOn || !state.playing) return;
    var video = document.getElementById('video');
    var item = state.playing;
    var quality = null;
    var choices = playbackQualities();
    for (var i = 0; i < choices.length; i++) if (item.playback && choices[i].url === item.playback.url) quality = choices[i];
    var rate = state.mp4FrameRate || (quality && quality.frameRate);
    if (state.hls) {
      var levelIndex = state.hls.currentLevel >= 0 ? state.hls.currentLevel : state.hls.loadLevel;
      var level = state.hls.levels[levelIndex];
      rate = state.hlsFrameRates[levelIndex] || (level && level.frameRate) || rate;
    }
    var total = video.webkitDecodedFrameCount;
    var dropped = video.webkitDroppedFrameCount;
    if (typeof video.getVideoPlaybackQuality === 'function') {
      var frames = video.getVideoPlaybackQuality();
      total = frames.totalVideoFrames;
      dropped = frames.droppedVideoFrames;
    }
    var buffer = 0;
    for (var b = 0; b < video.buffered.length; b++) {
      if (video.buffered.start(b) <= video.currentTime && video.buffered.end(b) >= video.currentTime) {
        buffer = video.buffered.end(b) - video.currentTime;
        break;
      }
    }
    var fps = rate > 0 && isFinite(rate) ? String(Math.round(rate * 100) / 100) + ' fps' : '—';
    var rows = [
      ['Decoded resolution', video.videoWidth ? video.videoWidth + ' × ' + video.videoHeight : 'Waiting for video'],
      ['Selected quality', quality ? quality.label : 'Source'],
      ['Stream', item.playback ? (state.hls ? 'HLS (MSE)' : item.playback.type.toUpperCase()) : 'Unavailable'],
      ['Codec', quality && quality.codec ? quality.codec : 'Not reported by source'],
      ['Source bitrate', quality && quality.bitrate ? (quality.bitrate / 1000000).toFixed(2) + ' Mbps' : 'Not reported by source'],
      ['Frames / dropped', typeof total === 'number' ? total + ' / ' + (dropped || 0) : 'Unavailable'],
      ['Position / duration', formatDuration(video.currentTime) + ' / ' + (item.live ? 'Live' : formatDuration(video.duration))],
      ['Player state', video.error ? 'Error ' + video.error.code : (item.playbackFailed ? 'Source failed' : (video.paused ? 'Paused' : (video.readyState < 3 ? 'Buffering' : 'Playing')))]
    ];
    if (window.HelloNetwork) rows = rows.concat(HelloNetwork.rows());
    var html = '<div class="telemetry-heading">Telemetry</div><div class="telemetry-gauges">' +
      '<div class="telemetry-gauge"><strong>' + esc(fps) + '</strong><span>Frame rate</span></div>' +
      '<div class="telemetry-gauge"><strong>' + buffer.toFixed(1) + ' s</strong><span>Buffer ahead</span></div></div><table>';
    for (var r = 0; r < rows.length; r++) html += '<tr><th>' + esc(rows[r][0]) + '</th><td>' + esc(rows[r][1]) + '</td></tr>';
    document.getElementById('statsPanel').innerHTML = html + '</table>';
  }

  function playbackQualities() {
    var item = state.playing;
    if (!item || !item.playback) return [];
    var qualities = item.qualities || [];
    return qualities.length ? qualities : [{ url: item.playback.url, type: item.playback.type, label: 'Source' }];
  }

  function applyPreferredQuality(item) {
    if (!prefs.qualityHeight || !item.qualities) return;
    // Catalogue qualities are sorted highest first. Use the best at or below
    // the preference, or the lowest available resolution if all are higher.
    var preferred = null;
    for (var i = 0; i < item.qualities.length; i++) {
      var quality = item.qualities[i];
      if (!quality.height) continue;
      preferred = quality;
      if (quality.height <= prefs.qualityHeight) break;
    }
    if (preferred) item.playback = { type: preferred.type, url: preferred.url };
  }

  function paintQualityButton() {
    var qualities = playbackQualities();
    var label = 'Source';
    for (var i = 0; i < qualities.length; i++) {
      if (state.playing && qualities[i].url === state.playing.playback.url) label = qualities[i].label;
    }
    document.getElementById('qualityLabel').textContent = label +
      (state.pendingQuality ? ' (' + state.pendingQuality.label + ' loading)' : '');
  }

  function paintQualityMenu() {
    var qualities = playbackQualities();
    var html = '<div class="quality-note">Playback quality</div>';
    for (var i = 0; i < qualities.length; i++) {
      var selected = state.playing && qualities[i].url === state.playing.playback.url;
      html += '<button type="button" class="quality-option' + (state.qualityIndex === i ? ' focused' : '') +
        '" data-i="' + i + '"' + (selected ? ' aria-current="true"' : '') + '>' + esc(qualities[i].label) + (selected ? CHECK : '') + '</button>';
    }
    if (qualities.length === 1) html += '<div class="quality-note">This source offers one quality.</div>';
    var menu = document.getElementById('qualityMenu');
    menu.innerHTML = html;
    menu.className = 'on';
    var buttons = menu.querySelectorAll('.quality-option');
    for (var p = 0; p < buttons.length; p++) {
      (function (btn, index) {
        btn.onclick = function (e) { e.stopPropagation(); chooseQuality(index); };
      })(buttons[p], p);
    }
  }

  function openQualityMenu() {
    if (!state.playing) return;
    if (state.postOpen) togglePost();
    if (state.captionsOpen) closeCaptionsMenu();
    closeFilmstrip();
    state.qualityOpen = true;
    state.playerZone = 'controls';
    state.playerAction = 3;
    paintPlayerActions();
    state.qualityIndex = 0;
    var qualities = playbackQualities();
    for (var i = 0; i < qualities.length; i++) if (qualities[i].url === state.playing.playback.url) state.qualityIndex = i;
    showControls(true);
    paintQualityMenu();
  }

  function closeQualityMenu() {
    state.qualityOpen = false;
    paintPlayerActions();
    document.getElementById('qualityMenu').className = '';
    showControls(false);
  }

  function chooseQuality(index) {
    var quality = playbackQualities()[index];
    if (!quality || !state.playing) return;
    if (quality.height && quality.height !== prefs.qualityHeight) {
      prefs.qualityHeight = quality.height;
      if (window.HelloFavourites) HelloFavourites.setSetting('qualityHeight', quality.height);
    }
    state.recoveryToken += 1;
    state.recoveryBusy = false;
    state.recoveryCount = 0;
    state.recoveryTried = {};
    state.recoveryRefreshed = false;
    state.recoveryFailed = false;
    state.recoveryMessage = '';
    var video = document.getElementById('video');
    if (quality.url === state.playing.playback.url && video.readyState >= 2 && !state.playing.playbackFailed) {
      state.pendingQuality = null;
      if (state.hls) state.hls.loadLevel = hlsQualityLevel(state.hls, quality);
      paintQualityButton();
      closeQualityMenu();
      return;
    }
    var level = state.hls ? hlsQualityLevel(state.hls, quality) : -1;
    if (level >= 0 && state.hls.levels.length > 1 && video.readyState >= 3 && !video.paused && !video.ended && !state.playing.playbackFailed) {
      state.pendingQuality = quality;
      sizeHlsBuffer(state.hls, quality);
      state.hls.loadLevel = level;
      paintQualityButton();
      closeQualityMenu();
      showToast('Switching to ' + quality.label + '...');
      return;
    }
    state.restoreTime = state.playing.live ? null : (state.restoreTime !== null ? state.restoreTime : video.currentTime);
    state.restorePaused = video.paused;
    state.wantPaused = video.paused;
    state.playing.playback = { type: quality.type, url: quality.url };
    startPlayback(state.playing);
    showToast('Quality: ' + quality.label);
  }

  function hlsLoadPolicy(maxLoadTime) {
    return { default: {
      maxTimeToFirstByteMs: 8000,
      maxLoadTimeMs: maxLoadTime,
      timeoutRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 1000 },
      errorRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 1000 }
    } };
  }

  // X's 4K MP4s declare a nonsense frame rate that makes the TV skip frames (see sps.js).
  // The same video's HLS stream can be corrected as it loads, so anything above 1080p
  // plays through that instead of the plain MP4 file.
  function correctedMaster(item) {
    var master = item.captionSource || '';
    if (!window.HelloSps || item.noCorrectedStream || master.indexOf('.m3u8') === -1) return '';
    var choices = playbackQualities();
    for (var i = 0; i < choices.length; i++) {
      if (choices[i].url === item.playback.url) return choices[i].height > 1080 ? master : '';
    }
    return '';
  }

  // X's video server has slow spells of about half a minute on this TV. A 4K stream
  // needs most of the connection, so it keeps a longer buffer to play through them.
  function sizeHlsBuffer(hls, quality) {
    var tall = !!quality && quality.height > 1080;
    hls.config.maxBufferLength = tall ? 30 : 20;
    hls.config.maxBufferSize = tall ? 90000000 : 40000000;
    hls.config.backBufferLength = tall ? 6 : 10;
  }

  function hlsQualityLevel(hls, quality) {
    var levels = hls.levels || [];
    for (var i = 0; i < levels.length; i++) {
      // Post video qualities are named by their short side, so a vertical 2160x3840 is 2160.
      if (levels[i].height === quality.height || Math.min(levels[i].width || levels[i].height, levels[i].height) === quality.height) return i;
      var urls = levels[i].url || [];
      if (urls.indexOf(quality.url) !== -1) return i;
    }
    return -1;
  }

  function armPlaybackRecovery() {
    clearTimeout(state.recoveryTimer);
    var video = document.getElementById('video');
    var item = state.playing;
    var token = state.recoveryToken;
    var position = video.currentTime;
    if (state.wantPaused || state.recoveryFailed) return;
    state.recoveryTimer = setTimeout(function () {
      if (state.screen !== 'player' || state.playing !== item || token !== state.recoveryToken || state.wantPaused || state.recoveryBusy) return;
      if (video.currentTime <= position + 0.25) recoverPlayback(item);
    }, 12000);
  }

  function recoverPlayback(item) {
    if (!item || state.screen !== 'player' || state.playing !== item || state.recoveryBusy || state.recoveryFailed) return;
    errorToken += 1;
    var video = document.getElementById('video');
    var failedUrl = item.playback && item.playback.url;
    var choices = playbackQualities().slice();
    var failedHeight = 0;
    for (var i = 0; i < choices.length; i++) if (choices[i].url === failedUrl) failedHeight = choices[i].height || 0;
    state.restoreTime = item.live ? null : (state.restoreTime !== null ? state.restoreTime : video.currentTime);
    state.restorePaused = state.wantPaused;
    state.pendingQuality = null;
    state.recoveryBusy = true;
    state.recoveryTried[failedUrl] = true;
    var token = ++state.recoveryToken;
    stopVideo(video);
    document.getElementById('errLabel').style.display = 'none';

    function current() { return token === state.recoveryToken && state.screen === 'player' && state.playing === item; }
    function lowerQuality() {
      if (!current()) return;
      state.recoveryBusy = false;
      if (state.recoveryCount < 3) {
        for (var q = 0; q < choices.length; q++) {
          var quality = choices[q];
          if (state.recoveryTried[quality.url] || (failedHeight && quality.height >= failedHeight) || (!failedHeight && quality.height > 1080)) continue;
          state.recoveryCount += 1;
          state.recoveryMessage = 'Trying ' + quality.label + '...';
          item.playback = { type: quality.type, url: quality.url };
          startPlayback(item);
          return;
        }
      }
      state.recoveryFailed = true;
      hideBufferingDetails();
      item.playbackFailed = true;
      if (item.broadcastId && window.HelloCatalog) HelloCatalog.forget(item.broadcastId);
      document.getElementById('loadLabel').style.display = 'none';
      var error = document.getElementById('errLabel');
      error.textContent = 'Playback is unavailable right now. Go back and try again.';
      error.style.display = 'block';
      showControls(true);
    }

    if (item.broadcastId && !state.recoveryRefreshed && state.recoveryCount < 3 && window.HelloCatalog) {
      state.recoveryRefreshed = true;
      state.recoveryCount += 1;
      state.recoveryMessage = 'Refreshing broadcast...';
      document.getElementById('loadLabel').textContent = state.recoveryMessage;
      document.getElementById('loadLabel').style.display = 'block';
      HelloCatalog.forget(item.broadcastId);
      var request = { broadcastId: item.broadcastId };
      HelloCatalog.resolve(request, function (error) {
        if (!current()) return;
        if (error || !request.playback) { lowerQuality(); return; }
        state.recoveryBusy = false;
        item.playback = request.playback;
        item.masterUrl = request.masterUrl;
        item.qualities = request.qualities || choices;
        item.live = request.live;
        item.replay = request.replay;
        for (var j = 0; j < item.qualities.length; j++) if (item.qualities[j].height === failedHeight) {
          item.playback = { type: item.qualities[j].type, url: item.qualities[j].url };
          break;
        }
        state.recoveryMessage = 'Retrying playback...';
        startPlayback(item);
      });
    } else lowerQuality();
  }

  function startPlayback(item) {
    if (!item || !item.playback || !item.playback.url) return;
    errorToken += 1;
    item.playbackFailed = false;
    var newSession = state.playing !== item || state.screen !== 'player';
    if (newSession) {
      saveResume(true);
      applyPreferredQuality(item);
      closeFilmstrip();
      clearTimeout(state.iconTimer);
      clearTimeout(state.seekTimer);
      document.getElementById('centerIcon').className = '';
      document.getElementById('seekPop').className = '';
      state.hasPlayed = false;
      state.overlayDismissed = false;
      state.recoveryToken += 1;
      state.recoveryCount = 0;
      state.recoveryTried = {};
      state.recoveryRefreshed = false;
      state.recoveryBusy = false;
      state.recoveryMessage = '';
      state.wantPaused = false;
      state.playerZone = 'timeline';
      state.playerAction = 0;
      var resume = !item.live && window.HelloFavourites ? HelloFavourites.position(item.id) : 0;
      state.restoreTime = resume > 0 ? resume : null;
      state.restorePaused = false;
      state.lastPositionSave = Date.now();
      state.postOpen = false;
      state.postTab = 0;
      state.postGen += 1;
      state.comments = [];
      state.commentsLoaded = false;
      state.commentsLoading = false;
      state.commentsError = false;
      state.commentsCursor = null;
      document.getElementById('postPanel').className = '';
    }
    state.playing = item;
    if (newSession) {
      state.captionsOpen = false;
      document.getElementById('captionsMenu').className = '';
      resetCaptions(item);
      if (state.broadcast) state.broadcast.close();
      state.broadcast = null;
      state.broadcastInfo = null;
      document.getElementById('broadcastAudience').textContent = '';
      if (item.broadcastId && window.HelloBroadcast) {
        state.broadcast = HelloBroadcast.watch(item.broadcastId, function (info) {
          if (state.playing !== item) return;
          state.broadcastInfo = info;
          var label = info.ended ? 'Broadcast ended' : info.live ?
            (info.watching === null ? 'LIVE · Viewer count unavailable' : 'LIVE · ' + info.watching.toLocaleString() + ' watching') : '';
          var audience = document.getElementById('broadcastAudience');
          audience.textContent = label;
          audience.className = info.live && !info.ended ? 'live' : '';
          if (state.postOpen && state.postTab === 2) paintPost();
        });
      }
    }
    state.recoveryFailed = false;
    state.pendingQuality = null;
    item.failed = false;
    state.recoveryTried[item.playback.url] = true;
    if (state.screen !== 'player') state.resumeScreen = state.screen;
    setScreen('player');
    state.qualityOpen = false;
    paintPlayerActions();
    document.getElementById('qualityMenu').className = '';
    var player = document.getElementById('player');
    player.className = item.live ? 'live' : '';
    document.getElementById('ptitle').textContent = item.title || '';
    document.getElementById('psub').innerHTML = playerMetaHtml(item);
    renderEmoji(document.getElementById('ptitle'));
    renderEmoji(document.getElementById('psub'));
    document.getElementById('errLabel').style.display = 'none';
    document.getElementById('loadLabel').style.display = 'block';
    document.getElementById('loadLabel').textContent = state.recoveryMessage || 'Loading';
    document.getElementById('tcur').textContent = item.live ? '' : '0:00';
    document.getElementById('tend').textContent = item.live ? 'LIVE' : (item.durationSec ? formatDuration(item.durationSec) : '');
    document.getElementById('played').style.width = item.live ? '100%' : '0';
    document.getElementById('buffered').style.width = '0';
    document.getElementById('knob').style.left = '0';
    var video = document.getElementById('video');
    stopVideo(video);
    var url = mediaUrl(item);
    var master = item.playback.type === 'hls' ? (item.masterUrl || url) : correctedMaster(item);
    if (master && window.Hls && Hls.isSupported()) {
      var hls = new Hls({
        autoStartLoad: false,
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: state.restoreTime !== null ? state.restoreTime : -1,
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        maxBufferSize: 40000000,
        backBufferLength: 10,
        manifestLoadPolicy: hlsLoadPolicy(12000),
        playlistLoadPolicy: hlsLoadPolicy(12000),
        fragLoadPolicy: hlsLoadPolicy(30000),
        fLoader: window.HelloSps ? HelloSps.loader(Hls) : undefined
      });
      state.hls = hls;
      if (window.HelloTranscription) {
        state.transcriber = HelloTranscription.attach(hls, video, {
          onCues: function (cues) {
            if (state.hls !== hls || !state.aiCaptions) return;
            state.captionCues = cues; paintCaptionText();
          },
          onStatus: function (text) {
            if (state.hls !== hls || !state.aiCaptions) return;
            state.aiStatus = text;
            if (state.captionsOpen) paintCaptionsMenu();
          }
        });
        if (state.aiCaptions) state.transcriber.enable(true);
      }
      hls.on(Hls.Events.ERROR, function (event, data) {
        var status = data.response && data.response.code;
        var unavailable = status === 403 || status === 404 || status === 410;
        if (state.hls !== hls || (!data.fatal && !unavailable)) return;
        if (state.pendingQuality && video.readyState >= 3) {
          state.pendingQuality = null;
          var current = playbackQualities();
          for (var q = 0; q < current.length; q++) if (current[q].url === item.playback.url) hls.loadLevel = hlsQualityLevel(hls, current[q]);
          hls.startLoad(video.currentTime);
          paintQualityButton();
          showToast('Keeping the current quality. The requested quality did not load.');
        } else playbackError(true);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (state.hls !== hls) return;
        var choices = playbackQualities();
        var matched = false;
        for (var q = 0; q < choices.length; q++) if (choices[q].url === item.playback.url) {
          var level = hlsQualityLevel(hls, choices[q]);
          if (level >= 0) { hls.startLevel = level; hls.loadLevel = level; matched = true; sizeHlsBuffer(hls, choices[q]); }
        }
        if (!matched && item.playback.type !== 'hls') {
          // The stream lacks this resolution: play the MP4 file as before.
          item.noCorrectedStream = true;
          setTimeout(function () { if (state.hls === hls && state.playing === item) startPlayback(item); }, 0);
          return;
        }
        hls.startLoad(state.restoreTime !== null ? state.restoreTime : -1);
      });
      hls.on(Hls.Events.FRAG_LOADING, function (event, data) {
        if (state.hls === hls && data.frag.type === 'main' && data.frag.sn !== 'initSegment') state.downloadFrag = data.frag;
      });
      hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
        if (state.hls !== hls) return;
        var load = data.frag.stats.loading;
        if (window.HelloNetwork && data.frag.type === 'main') HelloNetwork.sample(data.frag.stats.total, load.end - load.first, load.first - load.start, data.frag.url);
      });
      hls.on(Hls.Events.BUFFER_APPENDING, function (event, data) {
        if (!window.HelloSps || state.hls !== hls || data.parent !== 'main' || data.type === 'audio') return;
        var level = data.frag.level;
        if (state.hlsFrameRates[level]) return;
        var rate = HelloSps.frameRate(data.data);
        var timing = data.frag.elementaryStreams.video;
        if (!rate && data.type === 'video' && !data.part && timing && !timing.partial) {
          rate = HelloSps.fragmentFrameRate(data.data, timing.endDTS - timing.startDTS);
        }
        if (rate > 0 && isFinite(rate)) state.hlsFrameRates[level] = rate;
      });
      hls.on(Hls.Events.FRAG_CHANGED, function (event, data) {
        if (state.hls !== hls) return;
        var choices = playbackQualities();
        for (var q = 0; q < choices.length; q++) if (data.frag.level === hlsQualityLevel(hls, choices[q])) {
          item.playback = { type: choices[q].type || 'hls', url: choices[q].url };
          break;
        }
        if (state.pendingQuality && data.frag.level === hlsQualityLevel(hls, state.pendingQuality)) state.pendingQuality = null;
        paintQualityButton();
      });
      hls.attachMedia(video);
      hls.loadSource(master);
    } else if (item.playback.type === 'hls') {
      var source = document.createElement('source');
      source.setAttribute('src', url);
      source.setAttribute('type', 'application/vnd.apple.mpegurl');
      source.onerror = function () {
        if (source.parentNode === video) playbackError(true);
      };
      video.appendChild(source);
      try { video.load(); } catch (e) {}
    } else {
      video.src = url;
    }
    if (!state.overlayDismissed) showControls(true);
    var started = video.play();
    if (started && started.catch) started.catch(function () {});
    paintQualityButton();
    armPlaybackRecovery();
  }

  function closePlayer() {
    saveResume(true);
    closeFilmstrip();
    state.queue = null;
    showToast('');
    if (state.broadcast) state.broadcast.close();
    state.broadcast = null;
    state.broadcastInfo = null;
    document.getElementById('broadcastAudience').textContent = '';
    state.playGen += 1;
    state.opening = false;
    state.recoveryToken += 1;
    state.recoveryBusy = false;
    state.pendingQuality = null;
    state.restoreTime = null;
    state.qualityOpen = false;
    state.captionsOpen = false;
    document.getElementById('captionsMenu').className = '';
    resetCaptions(null);
    state.statsOn = false;
    clearInterval(state.statsTimer);
    if (window.HelloNetwork) HelloNetwork.stop();
    document.getElementById('statsPanel').className = '';
    state.postOpen = false;
    paintPlayerActions();
    state.postGen += 1;
    state.commentsLoading = false;
    document.getElementById('postPanel').className = '';
    stopVideo(document.getElementById('video'));
    state.playing = null;
    document.getElementById('player').className = '';
    if (state.resumeScreen === 'search') {
      setScreen('search');
      paintSearch();
    } else {
      setScreen('browse');
      renderBrowse();
    }
    if (state.screen === 'search') { searchPainted = null; paintSearchResults(); }
    replay(document.getElementById(state.screen === 'search' ? 'searchView' : 'stage'), 'return');
  }

  function togglePause() {
    var video = document.getElementById('video');
    if (video.paused || video.ended) {
      state.wantPaused = false;
      if (video.ended) {
        try { video.currentTime = 0; } catch (e) {}
      }
      var started = video.play();
      if (started && started.catch) started.catch(function () {});
      flashIcon('play');
    } else {
      state.wantPaused = true;
      video.pause();
      flashIcon('pause');
    }
    paintPlayButton();
    showControls(video.paused);
  }

  function seekBy(delta, pauseForScrub) {
    var item = state.playing;
    var video = document.getElementById('video');
    if (!item || item.live || !isFinite(video.duration)) {
      flashSeek('Live');
      return;
    }
    if (pauseForScrub) {
      state.wantPaused = true;
      video.pause();
    }
    var t = video.currentTime + delta;
    if (t < 0) t = 0;
    if (t > video.duration - 0.25) t = Math.max(0, video.duration - 0.25);
    try { video.currentTime = t; } catch (e) {}
    flashSeek((delta > 0 ? '+' : '') + delta + 's');
    paintProgress();
  }

  function activateNav() {
    var id = navButtons[state.navIndex].getAttribute('data-nav');
    if (id === 'home') {
      state.playGen += 1;
      state.opening = false;
      leaveHistory();
      setScreen('browse');
      state.zone = 'rows';
      state.browseIndex = 0;
      state.animateGrid = true;
      renderBrowse();
    } else if (id === 'search') {
      openSearch();
    } else if (id === 'history') {
      openHistory();
    } else if (id === 'coffee') {
      state.zone = 'nav';
      paintNav();
      if (!isTv()) window.open(coffeeUrl, '_blank', 'noopener,noreferrer');
    } else if (id === 'settings') {
      openSettings();
    } else if (id === 'refresh') {
      loadHome(true);
    } else if (id === 'back') {
      if (state.screen === 'search') onSearchKey(KEY.BACK);
      else onBrowseKey(KEY.BACK);
    }
  }

  function buildSettings() {
    var html = '';
    for (var i = 0; i < SETTINGS.length; i++) {
      html += '<button type="button" class="setting" role="switch" aria-checked="false">' +
        '<span class="setting-name">' + esc(SETTINGS[i].name) + '</span>' +
        '<span class="setting-desc">' + esc(SETTINGS[i].desc) + '</span><span class="switch" aria-hidden="true"></span></button>';
    }
    html += '<button type="button" class="setting groq-setting"><span class="setting-name">Live captions</span><span class="setting-desc" id="groqSettingStatus">Connect your own Groq account</span><span class="setting-arrow" aria-hidden="true">›</span></button>';
    var list = document.getElementById('settingsList');
    list.innerHTML = html;
    var rows = list.querySelectorAll('.setting');
    for (var r = 0; r < rows.length; r++) {
      (function (row, index) {
        row.onmousemove = function () {
          if (state.settingsIndex === index) return;
          state.settingsIndex = index;
          paintSettings();
        };
        row.onclick = function () {
          state.settingsIndex = index;
          activateSetting(index);
        };
      })(rows[r], r);
    }
    document.getElementById('settingsScrim').onclick = closeSettings;
    document.getElementById('settingsClose').onclick = closeSettings;
  }

  function paintSettings() {
    var rows = document.querySelectorAll('#settingsList .setting');
    for (var i = 0; i < rows.length; i++) {
      var on = i < SETTINGS.length && !!prefs[SETTINGS[i].id];
      rows[i].classList.toggle('on', on);
      rows[i].classList.toggle('focused', i === state.settingsIndex);
      if (i < SETTINGS.length) rows[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var groqStatus = document.getElementById('groqSettingStatus');
    if (groqStatus) groqStatus.textContent = window.HelloGroq && HelloGroq.key() ? 'Connected · Manage your Groq account' : 'Add captions to streams with your own Groq account';
  }

  function openSettings() {
    state.settingsOpen = true;
    state.settingsIndex = 0;
    paintSettings();
    document.getElementById('settings').className = 'on';
  }

  function closeSettings() {
    state.settingsOpen = false;
    document.getElementById('settings').className = '';
  }

  function activateSetting(index) {
    if (index === SETTINGS.length) { HelloGroq.open(); return; }
    var id = SETTINGS[index].id;
    prefs[id] = !prefs[id];
    if (window.HelloFavourites && HelloFavourites.setSetting) HelloFavourites.setSetting(id, prefs[id]);
    applyPrefs();
    // The sheet is already open; do not replay its entrance when animations come back on.
    document.getElementById('settings').className = 'on settled';
    if (id === 'artwork' && prefs.artwork && state.screen === 'browse') paintBackdrop(homeItems()[state.browseIndex]);
    paintSettings();
  }

  function onSettingsKey(code) {
    if (code === KEY.BACK || code === KEY.LEFT) closeSettings();
    else if (code === KEY.UP) state.settingsIndex = Math.max(0, state.settingsIndex - 1);
    else if (code === KEY.DOWN) state.settingsIndex = Math.min(SETTINGS.length, state.settingsIndex + 1);
    else if (code === KEY.ENTER) activateSetting(state.settingsIndex);
    else return code === KEY.RIGHT;
    if (state.settingsOpen) paintSettings();
    return true;
  }

  function openHistory() {
    state.playGen += 1;
    state.opening = false;
    if (!state.historyOpen) state.historyReturn = { chip: state.browseChipIndex, index: state.browseIndex, focus: state.focusId, scroll: document.getElementById('rows').scrollTop };
    state.historyOpen = true;
    state.browseChipIndex = 0;
    state.browseChipFocus = 0;
    state.browseIndex = 0;
    state.focusId = null;
    state.zone = 'rows';
    state.animateGrid = true;
    setScreen('browse');
    document.getElementById('rows').scrollTop = 0;
    renderBrowse();
  }

  function leaveHistory() {
    if (!state.historyOpen) return;
    var saved = state.historyReturn || {};
    state.historyOpen = false;
    state.browseChipIndex = saved.chip || 0;
    state.browseChipFocus = state.browseChipIndex;
    state.browseIndex = saved.index || 0;
    state.focusId = saved.focus || null;
    document.getElementById('rows').scrollTop = saved.scroll || 0;
  }

  function exitApp() {
    if (window.webOS && window.webOS.platformBack) window.webOS.platformBack();
    else window.close();
  }

  function onBrowseKey(code) {
    var items = browseItems;
    var options = homeOptions();
    var maxNav = navButtons.length - 1;
    if (code === KEY.BACK) {
      if (state.historyOpen) {
        leaveHistory();
        state.zone = 'nav';
        state.navIndex = 2;
        state.animateGrid = true;
        renderBrowse();
        return true;
      }
      if (state.browseChipIndex !== 0) {
        state.zone = 'homechips';
        chooseHomeFilter(0);
      } else if (state.zone !== 'nav') {
        state.zone = 'nav';
        state.navIndex = 0;
        paintFocus();
      } else exitApp();
      return true;
    }
    if (state.zone === 'nav') {
      if (code === KEY.UP) state.navIndex = Math.max(0, state.navIndex - 1);
      else if (code === KEY.DOWN) state.navIndex = Math.min(maxNav, state.navIndex + 1);
      else if (code === KEY.RIGHT) state.zone = items.length ? 'rows' : 'homechips';
      else if (code === KEY.ENTER) { activateNav(); return true; }
      else return false;
    } else if (state.zone === 'homechips') {
      if (code === KEY.LEFT) {
        if (state.browseChipFocus > 0) state.browseChipFocus -= 1;
        else { state.zone = 'nav'; state.navIndex = 0; }
      } else if (code === KEY.RIGHT) state.browseChipFocus = Math.min(options.length - 1, state.browseChipFocus + 1);
      else if (code === KEY.DOWN && items.length) { state.zone = 'rows'; state.browseIndex = 0; }
      else if (code === KEY.ENTER) chooseHomeFilter(state.browseChipFocus);
    } else {
      if (code === KEY.LEFT) {
        if (state.browseIndex % HOME_COLS === 0) { state.zone = 'nav'; state.navIndex = 0; }
        else state.browseIndex -= 1;
      } else if (code === KEY.RIGHT) {
        if (state.browseIndex % HOME_COLS < HOME_COLS - 1 && state.browseIndex < items.length - 1) state.browseIndex += 1;
      } else if (code === KEY.UP) {
        if (state.browseIndex < HOME_COLS) { state.zone = 'homechips'; state.browseChipFocus = state.browseChipIndex; }
        else state.browseIndex -= HOME_COLS;
      } else if (code === KEY.DOWN) {
        var nextRow = (Math.floor(state.browseIndex / HOME_COLS) + 1) * HOME_COLS;
        if (nextRow < items.length) state.browseIndex = Math.min(items.length - 1, state.browseIndex + HOME_COLS);
      } else if (code === KEY.ENTER) { playItem(items, state.browseIndex); return true; }
      else return false;
    }
    paintFocus();
    return true;
  }

  function onSearchKey(code) {
    if (code === KEY.BACK) {
      state.playGen += 1;
      state.opening = false;
      showToast('');
      setScreen('browse');
      state.zone = 'nav';
      state.navIndex = 1;
      state.animateGrid = true;
      renderBrowse();
      return true;
    }
    if (state.zone === 'nav') {
      if (code === KEY.RIGHT) {
        state.zone = 'keys';
        paintSearch();
      } else if (code === KEY.UP) state.navIndex = Math.max(0, state.navIndex - 1);
      else if (code === KEY.DOWN) state.navIndex = Math.min(navButtons.length - 1, state.navIndex + 1);
      else if (code === KEY.ENTER) activateNav();
      else return false;
      if (state.screen === 'search') paintSearchFocus();
      return true;
    }
    if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) {
      pressKey(String.fromCharCode(code).toLowerCase());
      return true;
    }
    if (code === 32) { pressKey('space'); return true; }
    if (state.zone === 'results') {
      var list = filtered();
      if (code === KEY.LEFT) {
        if (state.gridIndex % COLS === 0) {
          state.zone = 'keys';
          state.keyCol = KEYBOARD[state.keyRow].length - 1;
        } else state.gridIndex -= 1;
      } else if (code === KEY.RIGHT && state.gridIndex < list.length - 1) state.gridIndex += 1;
      else if (code === KEY.UP) {
        if (state.gridIndex < COLS) state.zone = 'chips';
        else state.gridIndex -= COLS;
      } else if (code === KEY.DOWN && state.gridIndex + COLS < list.length) state.gridIndex += COLS;
      else if (code === KEY.ENTER) { activateResult(); return true; }
      paintSearchFocus();
      return true;
    }
    if (state.zone === 'chips') {
      if (code === KEY.LEFT) {
        if (state.chipIndex > 0) selectChip(state.chipIndex - 1);
        else {
          state.zone = 'keys';
          state.keyCol = KEYBOARD[state.keyRow].length - 1;
        }
      } else if (code === KEY.RIGHT && state.chipIndex < CHIPS.length - 1) selectChip(state.chipIndex + 1);
      else if (code === KEY.UP) state.zone = 'keys';
      else if ((code === KEY.DOWN || code === KEY.ENTER) && filtered().length) {
        state.zone = 'results';
        state.gridIndex = 0;
      }
      paintSearchFocus();
      return true;
    }
    if (code === KEY.LEFT) {
      if (state.keyCol > 0) state.keyCol -= 1;
      else {
        state.zone = 'nav';
        state.navIndex = 1;
      }
    } else if (code === KEY.RIGHT) {
      if (state.keyCol < KEYBOARD[state.keyRow].length - 1) state.keyCol += 1;
      else state.zone = 'chips';
    } else if (code === KEY.UP && state.keyRow > 0) {
      state.keyRow -= 1;
      state.keyCol = Math.min(state.keyCol, KEYBOARD[state.keyRow].length - 1);
    } else if (code === KEY.DOWN) {
      if (state.keyRow < KEYBOARD.length - 1) {
        state.keyRow += 1;
        state.keyCol = Math.min(state.keyCol, KEYBOARD[state.keyRow].length - 1);
      } else state.zone = 'chips';
    } else if (code === KEY.ENTER) {
      pressKey(KEYBOARD[state.keyRow][state.keyCol]);
      return true;
    }
    paintSearchFocus();
    return true;
  }

  function onPlayerKey(code) {
    var video = document.getElementById('video');
    var controlsVisible = document.getElementById('chrome').className === 'on';
    if (code === KEY.BACK) {
      if (state.filmstripIndex >= 0) dismissFilmstrip();
      else if (playerMenuOpen() || controlsVisible) hidePlayerOverlay();
      else if (state.statsOn) toggleStats();
      else closePlayer();
      return true;
    }
    if (code === KEY.RED) { toggleStats(); return true; }
    showControls(false);
    if (code === KEY.BLUE) { if (state.qualityOpen) closeQualityMenu(); else openQualityMenu(); return true; }
    if (code === KEY.YELLOW) { togglePost(); return true; }
    if (code === KEY.GREEN) { toggleCaptionsMenu(); return true; }
    if (state.qualityOpen) {
      var qualities = playbackQualities();
      if (code === KEY.BACK || code === KEY.LEFT) closeQualityMenu();
      else if (code === KEY.UP) { state.qualityIndex = Math.max(0, state.qualityIndex - 1); paintQualityMenu(); }
      else if (code === KEY.DOWN) { state.qualityIndex = Math.min(qualities.length - 1, state.qualityIndex + 1); paintQualityMenu(); }
      else if (code === KEY.ENTER) chooseQuality(state.qualityIndex);
      return true;
    }
    if (state.captionsOpen) {
      var count = captionOptions().length;
      if (code === KEY.LEFT) closeCaptionsMenu();
      else if (code === KEY.UP) { state.captionsIndex = Math.max(0, state.captionsIndex - 1); paintCaptionsMenu(); }
      else if (code === KEY.DOWN) { state.captionsIndex = Math.min(count - 1, state.captionsIndex + 1); paintCaptionsMenu(); }
      else if (code === KEY.ENTER) {
        selectCaptionOption(state.captionsIndex);
      }
      return true;
    }
    if (state.postOpen) {
      if (code === KEY.LEFT || code === KEY.RIGHT) setPostTab(Math.max(0, Math.min(state.playing.broadcastId ? 2 : 1, state.postTab + (code === KEY.LEFT ? -1 : 1))));
      else if (code === KEY.UP || code === KEY.DOWN) document.getElementById('postBody').scrollTop += code === KEY.UP ? -160 : 160;
      else if (code === KEY.ENTER && state.postTab === 1 && (state.commentsCursor || state.commentsError)) loadComments(state.commentsCursor);
      else if (code === KEY.ENTER && state.postTab === 2 && state.broadcastInfo && state.broadcastInfo.chatState === 'error' && state.broadcast) state.broadcast.retry();
      else if (code === KEY.PLAY && video.paused) togglePause();
      else if (code === KEY.PAUSE && !video.paused) togglePause();
      return true;
    }
    if (code === KEY.PLAY) { if (video.paused) togglePause(); return true; }
    if (code === KEY.PAUSE) { if (!video.paused) togglePause(); return true; }
    if (state.playerZone === 'filmstrip') {
      if (code === KEY.LEFT || code === KEY.RIGHT) {
        focusFilmstrip(state.filmstripIndex + (code === KEY.LEFT ? -1 : 1));
        return true;
      }
      if (code === KEY.ENTER) { selectFilmstripItem(state.filmstripIndex); return true; }
      if (code === KEY.UP) { dismissFilmstrip(); return true; }
    }
    if (code === KEY.UP || code === KEY.DOWN) {
      if (code === KEY.UP && state.playerZone === 'back') {
        hidePlayerOverlay();
        return true;
      }
      if (code === KEY.DOWN && (state.playerZone === 'timeline' || (state.playerZone === 'controls' && state.filmstripIndex < 0)) &&
          state.queue && state.queue.items.length > 1) {
        if (controlsVisible) focusFilmstrip(state.queue.index);
        return true;
      }
      if (code === KEY.UP && state.playerZone === 'controls' && state.filmstripIndex >= 0) {
        focusFilmstrip(state.filmstripIndex);
        return true;
      }
      var zones = state.filmstripIndex >= 0 ? ['back', 'timeline', 'filmstrip', 'controls'] : ['back', 'timeline', 'controls'];
      var next = zones.indexOf(state.playerZone) + (code === KEY.UP ? -1 : 1);
      state.playerZone = zones[Math.max(0, Math.min(zones.length - 1, next))];
      paintPlayerActions();
      showControls(false);
      return true;
    }
    if (state.playerZone === 'back') {
      if (code === KEY.ENTER) { closePlayer(); return true; }
      if (code === KEY.LEFT || code === KEY.RIGHT) return true;
    }
    if (state.playerZone === 'controls') {
      var controls = document.querySelectorAll('.player-controls .player-action');
      if (code === KEY.LEFT) state.playerAction = Math.max(0, state.playerAction - 1);
      else if (code === KEY.RIGHT) state.playerAction = Math.min(controls.length - 1, state.playerAction + 1);
      else if (code === KEY.ENTER) {
        controls[state.playerAction].click();
        return true;
      } else if (code !== KEY.RW && code !== KEY.FF) return false;
      if (code === KEY.LEFT || code === KEY.RIGHT) { paintPlayerActions(); return true; }
    }
    if (code === KEY.ENTER) { togglePause(); return true; }
    if (code === KEY.LEFT || code === KEY.RW) { seekBy(-10, code === KEY.LEFT); return true; }
    if (code === KEY.RIGHT || code === KEY.FF) { seekBy(10, code === KEY.RIGHT); return true; }
    return false;
  }

  function hidePlayerOverlay() {
    state.overlayDismissed = true;
    clearTimeout(state.controlsTimer);
    closeFilmstrip();
    state.qualityOpen = false;
    state.captionsOpen = false;
    state.postOpen = false;
    if (state.broadcast) state.broadcast.setChatEnabled(false);
    document.getElementById('qualityMenu').className = '';
    document.getElementById('captionsMenu').className = '';
    document.getElementById('postPanel').className = '';
    document.getElementById('chrome').className = 'hide';
    state.playerZone = 'timeline';
    paintPlayerActions();
  }

  function tick() {
    var d = new Date();
    document.getElementById('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fitToWindow() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.body.style.transform = 'scale(' + s + ')';
    document.body.style.marginLeft = ((window.innerWidth - 1920 * s) / 2) + 'px';
    document.body.style.marginTop = ((window.innerHeight - 1080 * s) / 2) + 'px';
  }

  var video = document.getElementById('video');
  var errorToken = 0;
  video.onloadedmetadata = function () {
    if (state.restoreTime !== null && state.playing && !state.playing.live) {
      try { video.currentTime = Math.min(state.restoreTime, Math.max(0, video.duration - 0.25)); } catch (e) {}
      state.restoreTime = null;
    }
    if (state.restorePaused) {
      video.pause();
      state.restorePaused = false;
    }
    paintQualityButton();
  };
  video.onplaying = function () {
    hideBufferingDetails();
    if (state.playing && !state.hasPlayed) {
      state.hasPlayed = true;
      if (window.HelloFavourites) HelloFavourites.remember(state.playing, true);
      saveResume(true);
    }
    errorToken += 1;
    clearTimeout(state.recoveryTimer);
    state.recoveryFailed = false;
    state.recoveryMessage = '';
    document.getElementById('loadLabel').style.display = 'none';
    document.getElementById('errLabel').style.display = 'none';
    if (!state.overlayDismissed) showControls(false);
  };
  video.oncanplay = function () {
    hideBufferingDetails();
    if (state.screen === 'player') document.getElementById('loadLabel').style.display = 'none';
  };
  video.onplay = paintPlayButton;
  video.onseeked = paintCaptionText;
  video.onpause = function () {
    hideBufferingDetails();
    paintPlayButton();
    clearTimeout(state.recoveryTimer);
    if (state.screen === 'player' && !state.overlayDismissed) showControls(true);
  };
  video.onwaiting = function () {
    if (state.screen === 'player' && !state.recoveryFailed && !state.recoveryBusy) {
      document.getElementById('loadLabel').textContent = state.recoveryMessage || 'Buffering';
      document.getElementById('loadLabel').style.display = 'block';
      if (state.hasPlayed && !state.wantPaused) {
        paintBufferingDetails();
        clearInterval(state.bufferingTimer);
        state.bufferingTimer = setInterval(paintBufferingDetails, 1000);
      }
      armPlaybackRecovery();
    }
  };
  video.ontimeupdate = function () { paintProgress(); paintCaptionText(); saveResume(false); };
  video.onended = function () {
    if (state.screen !== 'player' || !state.playing) return;
    paintPlayButton();
    saveResume(true);
    showControls(true);
    var queue = state.queue;
    if (queue && queue.index + 1 < queue.items.length) openQueueItem(queue, queue.index + 1, true);
    else flashIcon('play');
  };
  function playbackError(sourceFailed) {
    if (state.screen !== 'player') return;
    var token = errorToken + 1;
    errorToken = token;
    var item = state.playing;
    setTimeout(function () {
      if (token !== errorToken) return;
      if (state.screen !== 'player') return;
      if (!sourceFailed && !video.error) return;
      recoverPlayback(item);
    }, 1200);
  }
  video.onerror = function () { playbackError(false); };

  document.getElementById('player').addEventListener('mousemove', function () {
    if (state.screen === 'player') showControls(false);
  });
  document.getElementById('player').addEventListener('click', function () {
    if (state.screen === 'player') togglePause();
  });
  document.getElementById('playerBack').onclick = function (e) {
    e.stopPropagation();
    closePlayer();
  };
  document.getElementById('qualityButton').onclick = function (e) {
    e.stopPropagation();
    if (state.qualityOpen) closeQualityMenu();
    else openQualityMenu();
  };
  document.getElementById('qualityMenu').onclick = function (e) { e.stopPropagation(); };
  document.getElementById('playButton').onclick = function (e) { e.stopPropagation(); togglePause(); };
  document.getElementById('captionsButton').onclick = function (e) {
    e.stopPropagation();
    toggleCaptionsMenu();
  };
  document.getElementById('captionsMenu').onclick = function (e) { e.stopPropagation(); };
  document.getElementById('statsPanel').onclick = function (e) { e.stopPropagation(); };
  document.getElementById('postButton').onclick = function (e) { e.stopPropagation(); togglePost(); };
  document.getElementById('postPanel').onclick = function (e) { e.stopPropagation(); };
  document.getElementById('filmstrip').onclick = function (e) { e.stopPropagation(); };
  document.getElementById('timeline').onclick = function (e) {
    e.stopPropagation();
    if (!state.playing || state.playing.live || !isFinite(video.duration) || video.duration <= 0) return;
    var rect = this.getBoundingClientRect();
    var fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = Math.min(video.duration - 0.25, fraction * video.duration);
    closeFilmstrip();
    state.playerZone = 'timeline';
    state.wantPaused = false;
    paintPlayerActions();
    var played = video.play();
    if (played && played.catch) played.catch(function () {});
    saveResume(true);
    paintProgress();
    showControls(false);
  };

  document.getElementById('playerBack').onmousemove = function () {
    if (state.playerZone === 'back') return;
    state.playerZone = 'back';
    paintPlayerActions();
  };
  var playerActions = document.querySelectorAll('.player-controls .player-action');
  for (var actionIndex = 0; actionIndex < playerActions.length; actionIndex++) {
    (function (button, index) {
      button.onmousemove = function () {
        state.playerZone = 'controls';
        state.playerAction = index;
        paintPlayerActions();
      };
    })(playerActions[actionIndex], actionIndex);
  }

  var coffeeButton = document.getElementById('coffeeButton');
  var coffeeUrl = window.HELLO_TV && HELLO_TV.coffeeUrl;
  coffeeButton.hidden = typeof coffeeUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(coffeeUrl);
  coffeeButton.onmouseleave = paintNav;
  var navButtons = document.querySelectorAll('#nav .nav-btn:not([hidden])');
  for (var i = 0; i < navButtons.length; i++) {
    (function (btn, index) {
      btn.onmousemove = function () {
        if (state.screen === 'player') return;
        navPointerFocus = true;
        state.zone = 'nav';
        state.navIndex = index;
        if (state.screen === 'browse') paintFocus();
        else paintSearchFocus();
      };
      btn.onclick = function () {
        state.navIndex = index;
        activateNav();
      };
    })(navButtons[i], i);
  }

  document.getElementById('stage').addEventListener('wheel', function (e) {
    if (state.screen !== 'browse') return;
    if (e.deltaY > 0) onBrowseKey(KEY.DOWN);
    else if (e.deltaY < 0) onBrowseKey(KEY.UP);
    e.preventDefault();
  });

  document.addEventListener('keydown', function (e) {
    if (window.HelloGroq && HelloGroq.isOpen()) { HelloGroq.handleKey(e); return; }
    if (state.screen === 'search' && !state.settingsOpen && state.zone !== 'nav' && (e.keyCode === 8 || e.key === '_' || e.key === '@')) {
      pressKey(e.keyCode === 8 ? '⌫' : e.key);
      e.preventDefault();
      return;
    }
    var rawCode = e.keyCode || e.which;
    var code = PC_KEYS[rawCode] || rawCode;
    if (code === KEY.UP || code === KEY.DOWN || code === KEY.LEFT || code === KEY.RIGHT) navPointerFocus = false;
    if (e.key === 'BrowserBack' || e.key === 'GoBack' || e.key === 'Back') code = KEY.BACK;
    if (e.repeat && (code === KEY.BACK || (code === KEY.UP && state.screen === 'player' && state.overlayDismissed))) {
      e.preventDefault();
      return;
    }
    if (code === KEY.BACK) {
      if (state.opening) showToast('');
      state.playGen += 1;
      state.opening = false;
    }
    var handled = false;
    if (state.settingsOpen) handled = onSettingsKey(code);
    else if (state.screen === 'player') handled = onPlayerKey(code);
    else if (state.screen === 'search') handled = onSearchKey(code);
    else handled = onBrowseKey(code);
    if (handled) e.preventDefault();
  });

  loadPrefs();
  buildSettings();
  if (window.HelloGroq) HelloGroq.onChange = function (connected) {
    if (connected) {
      prefs.captions = 'auto'; HelloFavourites.setSetting('captions', 'auto');
      if (state.playing) chooseAiCaption(false);
    } else {
      if (state.aiCaptions) chooseCaption(-1, false);
      if (prefs.captions === 'ai' || prefs.captions === 'auto') { prefs.captions = ''; HelloFavourites.setSetting('captions', ''); }
    }
    paintSettings();
  };
  window.addEventListener('resize', fitToWindow);
  window.addEventListener('pagehide', function () { saveResume(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveResume(true); });
  fitToWindow();
  tick();
  setInterval(tick, 10000);
  setInterval(function () {
    if (state.screen === 'browse' && state.data) loadHome(false);
  }, 60000);
  paintNav();
  if (window.HelloFavourites) {
    HelloFavourites.onError = function () { showToast('Settings could not be saved. Try again.'); };
    HelloFavourites.ready(function () {
      loadPrefs();
      loadHome(false);
    });
  } else loadHome(false);
})();

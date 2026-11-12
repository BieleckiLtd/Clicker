// ES5. X's encoder writes a nonsense frame rate into the H.264 header (SPS VUI timing:
// 1 / 480000, i.e. 240000 fps) while the MP4 container holds the real one. At 1080p the
// TV ignores it; at 2160p its H.264 decoder (rated 4K at 30 fps) believes it and skips
// frames. An fMP4 HLS stream carries the SPS only in its init segment, so the timing is
// corrected there, from the container's own sample duration, before hls.js appends it.
(function () {
  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function setU32(b, o, v) { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }
  function type(b, o) { return String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]); }

  // Offsets of every direct child box of the given type inside [from, to).
  function boxes(b, from, to, want) {
    var out = [];
    var o = from;
    while (o + 8 <= to) {
      var size = u32(b, o);
      if (size < 8 || o + size > to) break;
      if (type(b, o) === want) out.push(o);
      o += size;
    }
    return out;
  }
  function box(b, from, to, want) { var list = boxes(b, from, to, want); return list.length ? list[0] : -1; }
  function end(b, o) { return o + u32(b, o); }

  function defaultSampleDuration(b, moov, trackId) {
    var mvex = box(b, moov + 8, end(b, moov), 'mvex');
    var trexes = mvex < 0 ? [] : boxes(b, mvex + 8, end(b, mvex), 'trex');
    for (var i = 0; i < trexes.length; i++) {
      var trex = trexes[i];
      if (trex + 24 <= end(b, trex) && u32(b, trex + 12) === trackId) return u32(b, trex + 20);
    }
    return 0;
  }

  function frameRate(data) {
    var b = data instanceof Uint8Array ? data : new Uint8Array(data);
    var moov = box(b, 0, b.length, 'moov');
    if (moov < 0) return 0;
    var traks = boxes(b, moov + 8, end(b, moov), 'trak');
    for (var i = 0; i < traks.length; i++) {
      var trak = traks[i];
      var mdia = box(b, trak + 8, end(b, trak), 'mdia');
      if (mdia < 0) continue;
      var hdlr = box(b, mdia + 8, end(b, mdia), 'hdlr');
      var mdhd = box(b, mdia + 8, end(b, mdia), 'mdhd');
      if (hdlr < 0 || hdlr + 20 > end(b, hdlr) || type(b, hdlr + 12) !== 'vide' || mdhd < 0) continue;
      var scaleOffset = mdhd + (b[mdhd + 8] === 1 ? 28 : 20);
      if (scaleOffset + 4 > end(b, mdhd)) continue;
      var timescale = u32(b, scaleOffset);
      var minf = box(b, mdia + 8, end(b, mdia), 'minf');
      var stbl = minf < 0 ? -1 : box(b, minf + 8, end(b, minf), 'stbl');
      var stts = stbl < 0 ? -1 : box(b, stbl + 8, end(b, stbl), 'stts');
      if (stts >= 0 && stts + 16 <= end(b, stts)) {
        var entries = u32(b, stts + 12);
        var samples = 0;
        var ticks = 0;
        if (stts + 16 + entries * 8 <= end(b, stts)) {
          for (var j = 0; j < entries; j++) {
            var offset = stts + 16 + j * 8;
            var count = u32(b, offset);
            samples += count;
            ticks += count * u32(b, offset + 4);
          }
        }
        if (ticks) return timescale * samples / ticks;
      }
      var tkhd = box(b, trak + 8, end(b, trak), 'tkhd');
      if (tkhd < 0) continue;
      var idOffset = tkhd + (b[tkhd + 8] === 1 ? 28 : 20);
      if (idOffset + 4 > end(b, tkhd)) continue;
      var duration = defaultSampleDuration(b, moov, u32(b, idOffset));
      if (duration) return timescale / duration;
    }
    return 0;
  }

  // hls.js remuxes MPEG-TS video into its own single-track MP4 fragments.
  function fragmentFrameRate(b, seconds) {
    if (!(seconds > 0)) return 0;
    var moof = box(b, 0, b.length, 'moof');
    var traf = moof < 0 ? -1 : box(b, moof + 8, end(b, moof), 'traf');
    var trun = traf < 0 ? -1 : box(b, traf + 8, end(b, traf), 'trun');
    return trun >= 0 && trun + 16 <= end(b, trun) ? u32(b, trun + 12) / seconds : 0;
  }

  function gcd(a, c) { while (c) { var t = a % c; a = c; c = t; } return a; }

  function unescape(b, from, to) {
    var out = [];
    var zeros = 0;
    for (var i = from; i < to; i++) {
      if (zeros >= 2 && b[i] === 3) { zeros = 0; continue; }
      out.push(b[i]);
      zeros = b[i] === 0 ? zeros + 1 : 0;
    }
    return out;
  }

  function escape(rbsp) {
    var out = [];
    var zeros = 0;
    for (var i = 0; i < rbsp.length; i++) {
      if (zeros >= 2 && rbsp[i] <= 3) { out.push(3); zeros = 0; }
      out.push(rbsp[i]);
      zeros = rbsp[i] === 0 ? zeros + 1 : 0;
    }
    return out;
  }

  function Reader(bytes) { this.b = bytes; this.p = 0; }
  Reader.prototype.bit = function () {
    if (this.p >= this.b.length * 8) throw new Error('sps');
    var v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1;
    this.p += 1;
    return v;
  };
  Reader.prototype.bits = function (n) { var v = 0; for (var i = 0; i < n; i++) v = v * 2 + this.bit(); return v; };
  Reader.prototype.ue = function () {
    var zeros = 0;
    while (this.bit() === 0) { zeros += 1; if (zeros > 32) throw new Error('sps'); }
    return Math.pow(2, zeros) - 1 + this.bits(zeros);
  };
  Reader.prototype.se = function () { var v = this.ue(); return v % 2 ? (v + 1) / 2 : -(v / 2); };

  function skipScalingList(r, size) {
    var last = 8;
    var next = 8;
    for (var j = 0; j < size; j++) {
      if (next !== 0) next = (last + r.se() + 256) % 256;
      last = next === 0 ? last : next;
    }
  }

  // Bit position of num_units_in_tick in the SPS payload (after the NAL header), or -1
  // when the SPS has no timing info.
  function timingPosition(rbsp) {
    var r = new Reader(rbsp);
    var profile = r.bits(8);
    r.bits(16);
    r.ue();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].indexOf(profile) !== -1) {
      var chroma = r.ue();
      if (chroma === 3) r.bit();
      r.ue(); r.ue(); r.bit();
      if (r.bit()) for (var i = 0; i < (chroma !== 3 ? 8 : 12); i++) if (r.bit()) skipScalingList(r, i < 6 ? 16 : 64);
    }
    r.ue();
    var pocType = r.ue();
    if (pocType === 0) r.ue();
    else if (pocType === 1) {
      r.bit(); r.se(); r.se();
      var cycle = r.ue();
      for (var c = 0; c < cycle; c++) r.se();
    }
    r.ue(); r.bit(); r.ue(); r.ue();
    if (!r.bit()) r.bit();
    r.bit();
    if (r.bit()) { r.ue(); r.ue(); r.ue(); r.ue(); }
    if (!r.bit()) return -1;                                  // No VUI.
    if (r.bit() && r.bits(8) === 255) r.bits(32);             // Aspect ratio.
    if (r.bit()) r.bit();                                     // Overscan.
    if (r.bit()) { r.bits(4); if (r.bit()) r.bits(24); }      // Video signal type.
    if (r.bit()) { r.ue(); r.ue(); }                          // Chroma location.
    if (!r.bit()) return -1;                                  // No timing info.
    return r.p;
  }

  function writeBits(bytes, pos, value) {
    for (var i = 0; i < 32; i++) {
      var p = pos + i;
      var mask = 1 << (7 - (p & 7));
      if (Math.floor(value / Math.pow(2, 31 - i)) % 2) bytes[p >> 3] |= mask;
      else bytes[p >> 3] &= ~mask;
    }
  }

  // Standard rates as [num_units_in_tick, time_scale]. The init segment's default sample
  // duration can be about 1% off for slightly variable sources (30.3 for a 29.97 clip);
  // the nearest standard rate is used so a 30 fps video is never declared as faster.
  var RATES = [[1001, 48000], [1, 48], [1, 50], [1001, 60000], [1, 60], [1, 100], [1001, 120000], [1, 120]];

  // Returns the corrected SPS NAL bytes, or null when the SPS already agrees with the
  // container (within 0.5%) or cannot be read.
  function fixSps(b, from, to, duration, timescale) {
    var rbsp = unescape(b, from + 1, to);
    var pos = timingPosition(rbsp);
    if (pos < 0 || pos + 64 > rbsp.length * 8) return null;
    var r = new Reader(rbsp);
    r.p = pos;
    var units = r.bits(32);
    var scale = r.bits(32);
    var real = timescale / duration;
    if (units && Math.abs(scale / (2 * units) - real) / real < 0.005) return null;
    var g = gcd(duration, 2 * timescale);
    var newUnits = duration / g;
    var newScale = 2 * timescale / g;
    var nearest = 0.015;
    for (var i = 0; i < RATES.length; i++) {
      var off = Math.abs(RATES[i][1] / (2 * RATES[i][0]) - real) / real;
      if (off < nearest) { nearest = off; newUnits = RATES[i][0]; newScale = RATES[i][1]; }
    }
    if (units === newUnits && scale === newScale) return null;
    if (newUnits < 1 || newScale < 1 || newUnits > 4294967295 || newScale > 4294967295) return null;
    writeBits(rbsp, pos, newUnits);
    writeBits(rbsp, pos + 32, newScale);
    return [b[from]].concat(escape(rbsp));
  }

  // Fixes SPS number `index` of the first H.264 track. Returns a new Uint8Array, false
  // when that SPS needs no change, or null when there is nothing (more) to look at.
  function fixOne(b, index) {
    var moov = box(b, 0, b.length, 'moov');
    if (moov < 0) return null;
    var traks = boxes(b, moov + 8, end(b, moov), 'trak');
    for (var t = 0; t < traks.length; t++) {
      var trak = traks[t];
      var tkhd = box(b, trak + 8, end(b, trak), 'tkhd');
      var mdia = box(b, trak + 8, end(b, trak), 'mdia');
      if (tkhd < 0 || mdia < 0) continue;
      var mdhd = box(b, mdia + 8, end(b, mdia), 'mdhd');
      var minf = box(b, mdia + 8, end(b, mdia), 'minf');
      if (mdhd < 0 || minf < 0) continue;
      var stbl = box(b, minf + 8, end(b, minf), 'stbl');
      if (stbl < 0) continue;
      var stsd = box(b, stbl + 8, end(b, stbl), 'stsd');
      if (stsd < 0) continue;
      var entry = box(b, stsd + 16, end(b, stsd), 'avc1');
      if (entry < 0) entry = box(b, stsd + 16, end(b, stsd), 'avc3');
      if (entry < 0) continue;
      var avcC = box(b, entry + 86, end(b, entry), 'avcC');
      if (avcC < 0) return null;

      var trackId = u32(b, tkhd + (b[tkhd + 8] === 1 ? 28 : 20));
      var timescale = u32(b, mdhd + (b[mdhd + 8] === 1 ? 28 : 20));
      var duration = defaultSampleDuration(b, moov, trackId);
      if (!timescale || !duration) return null;

      var count = b[avcC + 13] & 31;
      var p = avcC + 14;
      for (var s = 0; s < count; s++) {
        var length = (b[p] << 8) | b[p + 1];
        if (p + 2 + length > end(b, avcC)) return null;
        if (s === index) {
          var sps = fixSps(b, p + 2, p + 2 + length, duration, timescale);
          if (!sps) return false;
          var delta = sps.length - length;
          var out = new Uint8Array(b.length + delta);
          out.set(b.subarray(0, p + 2), 0);
          out.set(sps, p + 2);
          out.set(b.subarray(p + 2 + length), p + 2 + sps.length);
          out[p] = (sps.length >> 8) & 255;
          out[p + 1] = sps.length & 255;
          var parents = [moov, trak, mdia, minf, stbl, stsd, entry, avcC];
          for (var q = 0; q < parents.length; q++) setU32(out, parents[q], u32(b, parents[q]) + delta);
          return out;
        }
        p += 2 + length;
      }
      return null;
    }
    return null;
  }

  // Takes an fMP4 init segment (ArrayBuffer). Returns a corrected ArrayBuffer, or null
  // when no correction is needed or the segment is not understood.
  function fixInit(buffer) {
    try {
      var b = new Uint8Array(buffer);
      var changed = false;
      for (var index = 0; index < 4; index++) {
        var next = fixOne(b, index);
        if (next === null) break;
        if (next) { b = next; changed = true; }
      }
      return changed ? b.buffer : null;
    } catch (e) {
      return null;
    }
  }

  // An hls.js fragment loader that corrects init segments as they arrive.
  function loader(Hls) {
    var Base = Hls.DefaultConfig.loader;
    return function (config) {
      var inner = new Base(config);
      var load = inner.load;
      inner.load = function (context, loadConfig, callbacks) {
        var done = callbacks.onSuccess;
        callbacks.onSuccess = function (response, stats, ctx, details) {
          if (ctx && ctx.frag && ctx.frag.sn === 'initSegment' && response && response.data && response.data.byteLength) {
            var fixed = fixInit(response.data);
            if (fixed) response.data = fixed;
          }
          done(response, stats, ctx, details);
        };
        load.call(inner, context, loadConfig, callbacks);
      };
      return inner;
    };
  }

  window.HelloSps = { fixInit: fixInit, loader: loader, frameRate: frameRate, fragmentFrameRate: fragmentFrameRate };
})();

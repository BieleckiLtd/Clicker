const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { Uint8Array, Math, String, Error };
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/sps.js'), 'utf8'), context);
const sps = context.HelloSps;

// The real init segment of X's 2160p HLS variant for Porsche post 2079945544194011444:
// 23.976 fps in the container, 240000 fps in the H.264 header.
const init = fs.readFileSync(path.join(__dirname, 'fixtures/x-4k-init.mp4'));
const buffer = () => init.buffer.slice(init.byteOffset, init.byteOffset + init.length);

function boxes(bytes, from, to, out = {}) {
  for (let o = from; o + 8 <= to;) {
    const size = bytes.readUInt32BE(o), type = bytes.toString('latin1', o + 4, o + 8);
    assert.ok(size >= 8 && o + size <= to, type + ' stays inside its parent');
    out[type] = { start: o, size };
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex'].includes(type)) boxes(bytes, o + 8, o + size, out);
    if (type === 'stsd') boxes(bytes, o + 16, o + size, out);
    if (type === 'avc1') boxes(bytes, o + 86, o + size, out);
    o += size;
    if (o === to) return out;
  }
  assert.fail('boxes do not fill their parent');
}

test("X's impossible H.264 frame rate is replaced by the container's real one", () => {
  const before = boxes(init, 0, init.length);
  assert.match(init.toString('hex', before.avcC.start + 8, before.avcC.start + before.avcC.size), /40000003004001d4c0/, 'fixture declares 1 / 480000');
  const fixed = Buffer.from(sps.fixInit(buffer()));
  const after = boxes(fixed, 0, fixed.length);
  const avcC = fixed.subarray(after.avcC.start + 8, after.avcC.start + after.avcC.size);
  // num_units_in_tick 1001, time_scale 48000: 23.976 frames per second.
  assert.match(avcC.toString('hex'), /400000fa40002ee0/);
  assert.equal(avcC.readUInt16BE(6), init.readUInt16BE(before.avcC.start + 14) - 1, 'SPS length follows the removed escape byte');
  assert.equal(fixed.length, init.length - 1);
  for (const type of ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC']) assert.equal(after[type].size, before[type].size - 1, type);
  for (const type of ['mvex', 'trex', 'mdhd', 'tkhd']) assert.equal(after[type].size, before[type].size, type);
  assert.deepEqual(fixed.subarray(after.avcC.start + after.avcC.size), init.subarray(before.avcC.start + before.avcC.size), 'everything after the header is untouched');
});

test('a correct or unreadable init segment is left alone', () => {
  const fixed = sps.fixInit(buffer());
  assert.equal(sps.fixInit(fixed), null, 'already correct');
  assert.equal(sps.fixInit(new Uint8Array([0, 0, 0, 8, 109, 111, 111, 118]).buffer), null, 'empty moov');
  assert.equal(sps.fixInit(new Uint8Array(64).buffer), null, 'not MP4');
  assert.equal(sps.fixInit(buffer().slice(0, 500)), null, 'truncated');
});

test('a sample duration that is slightly off snaps to the nearest standard rate', () => {
  const bytes = Buffer.from(init);
  const trex = bytes.indexOf('trex');
  assert.equal(bytes.readUInt32BE(trex + 16), 100100);
  bytes.writeUInt32BE(99100, trex + 16);                      // 24.22 fps: nearest is 24.
  const fixed = sps.fixInit(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  // num_units_in_tick 1, time_scale 48.
  assert.match(Buffer.from(fixed).toString('hex'), /40000003004000000c/);
  assert.equal(sps.fixInit(fixed), null, 'the corrected header is stable');
});

test('the hls.js loader corrects init segments only', () => {
  const seen = [];
  function Base() { this.load = (context, config, callbacks) => callbacks.onSuccess({ data: buffer() }, {}, context, null); }
  const Loader = sps.loader({ DefaultConfig: { loader: Base } });
  const loader = new Loader({});
  loader.load({ frag: { sn: 'initSegment' } }, {}, { onSuccess: response => seen.push(response.data.byteLength) });
  loader.load({ frag: { sn: 0 } }, {}, { onSuccess: response => seen.push(response.data.byteLength) });
  assert.deepEqual(seen, [init.length - 1, init.length]);
});

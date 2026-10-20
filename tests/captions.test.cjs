const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { setTimeout, clearTimeout };
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/captions.js'), 'utf8'), context);
const captions = context.HelloCaptions;

test('subtitle tracks are read from an X HLS master with readable names and absolute URLs', () => {
  const master = 'https://video.twimg.com/amplify_video/1/pl/master.m3u8?tag=29';
  const tracks = captions.parseMaster([
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="en (auto-generated)",DEFAULT=NO,URI="/amplify_video/1/pl/s0/en.m3u8",LANGUAGE="en",CHARACTERISTICS="twitter.auto-generated"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Polski",URI="s1/pl.m3u8",LANGUAGE="pl"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",URI="audio.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000,SUBTITLES="subs"',
    'video.m3u8'
  ].join('\n'), master);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].name, 'English (auto-generated)');
  assert.equal(tracks[0].url, 'https://video.twimg.com/amplify_video/1/pl/s0/en.m3u8');
  assert.equal(tracks[1].name, 'Polish');
  assert.equal(tracks[1].url, 'https://video.twimg.com/amplify_video/1/pl/s1/pl.m3u8');
});

test('WebVTT cues lose markup tags, decode entities, and are found by time', () => {
  const cues = captions.parseVtt([
    'WEBVTT', 'X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000', '',
    'NOTE a comment', '',
    '2', '00:05.500 --> 00:07.000 align:center', 'Later line', '',
    '1', '00:00:00.620 --> 00:00:03.245', '<X-word-ms ms=20 index=1>T minus &amp; counting</X-word-ms>', '<i>second</i> row', ''
  ].join('\r\n'));
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 0.62);
  assert.equal(cues[0].text, 'T minus & counting\nsecond row');
  assert.equal(cues[1].start, 5.5);
  assert.equal(captions.at(cues, 1), 'T minus & counting\nsecond row');
  assert.equal(captions.at(cues, 4), '');
  assert.equal(captions.at(cues, 6), 'Later line');
});

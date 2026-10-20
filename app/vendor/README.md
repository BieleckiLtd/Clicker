# Bundled dependencies

These assets ship inside the TV package. Font and emoji rendering does not require an external CDN.

## hls.js 1.7.3

`hls.min.js` is the official ES5 UMD bundle from the pinned npm development dependency `hls.js@1.7.3`, copied from `node_modules/hls.js/dist/hls.min.js`. `hls.LICENSE.txt` is the corresponding Apache-2.0 license. Source: https://github.com/video-dev/hls.js.

## Twemoji 17.0.3

`twemoji.min.js` is copied from `node_modules/@twemoji/api/dist/twemoji.min.js` with the npm dependency pinned to 17.0.3. The 4,009 unmodified SVG files in `twemoji/svg/` and both license files come from `assets/svg/`, `LICENSE`, and `LICENSE-GRAPHICS` in https://github.com/jdecked/twemoji/tree/v17.0.3.

The parser uses DOM text nodes and local SVG paths. Dynamic text is escaped before insertion. Original Unicode is retained as image alt text. Code: MIT. Artwork: Copyright Twitter and contributors, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/.

## Noto fonts

The static TrueType files in `../fonts/` are unmodified copies from https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf: NotoSans/NotoSans-Regular.ttf, NotoSans/NotoSans-SemiBold.ttf, NotoSansMath/NotoSansMath-Regular.ttf, and NotoSansSymbols2/NotoSansSymbols2-Regular.ttf. The archived repository's `LICENSE` is copied to `../fonts/OFL.txt` (SIL Open Font License 1.1).

Static fonts work on Chromium 53. Noto Sans supplies Latin accents, Greek, Cyrillic, and punctuation; Math and Symbols supply additional symbols and styled letters. Emoji use local Twemoji images, including recent symbols such as the disco ball.

After changing a bundled script, run the ES5 parsing check and playback tests before packaging. Keep npm versions, copied bundles, artwork versions, and license files consistent.

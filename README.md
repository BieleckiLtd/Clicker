# X TV

A standalone webOS TV app for videos and broadcasts from public X channels. The TV fetches content directly, without a PC content server or X login.

## Browsing and favourites

The interface is black and mostly monochrome, with red reserved for live content. A slim icon rail opens when focused: the page slides aside to reveal it rather than being covered. A white focus ring glides between cards as the focused card zooms, and the focused video's artwork fades in behind the header. Rows scroll smoothly, keeping the focused row at the top. **Settings** (bottom of the rail) can turn off **Animations** (for older TVs) and **Background artwork**. These choices are stored with your favourites and survive package updates.

Home has a four-column grid with Hot, Live, Videos, and each saved channel. Hot ranks videos from the past 24 hours by views with an age penalty, and includes current live streams first. It covers saved channels. Videos stays chronological; each channel includes its older videos and replays. When more than four channels are saved, their filters show avatars; hovering or remote focus smoothly expands the channel title. The rail occupies its own space, with the version at the bottom. Live has a recording dot when a live broadcast is present. Search matches channel names and handles, then collects recent videos and broadcasts from the first six matches; it does not search every X post by keyword. Search shows progress and supports All / Live / Videos / Channels.

Press OK on a channel in Search to add or remove it from favourites. TV favourites and playback positions are stored in webOS DB8 so package updates do not erase them. The desktop preview uses localStorage and has its own favourites.

Thumbnails show a white progress bar and percentage watched, or a full bar and Watched marker. History in the sidebar lists every retained played video/broadcast, newest playback first, with All / In progress / Watched filters. Entries are saved when playback starts, survive restarts and package updates through DB8, and reopen using fresh post/broadcast links. Existing positions migrate into History; entries without recoverable metadata show a generic title. Expiring playback URLs are not stored in History. Live streams appear in History without a progress bar.

## Playback

- Videos and replays resume from their saved position. Progress is saved every five seconds and on exit; completed videos restart from the beginning while retaining the Watched marker. The final three seconds (or final 5% for short clips) count as completion. Live streams open live.
- The player shows a round Back button at the top left, then the title, the timeline (elapsed time left, length right) and one control row at the bottom: Play / Pause on the left, and **Captions**, **Post & comments** and **Quality** on the right. Quality and Captions open upward. There are no on-screen key instructions.
- Focus starts on the timeline: Left / Right seeks ten seconds and OK pauses. Up moves to Back; Down moves to the control row, where Left / Right chooses a button and OK presses it. Click the timeline with the cursor to seek and continue playing.
- **Captions** lists the subtitle tracks X provides for a video (often auto-generated English); the app downloads the public WebVTT file and draws the text itself. Your choice of language, or Off, is remembered. **Live transcription · Groq** generates captions for HLS broadcasts using your own Groq key.
- Red opens Quality. The list includes the resolutions supplied by the source, including 2160p / 4K when available. The default is the highest available resolution up to 1080p; vertical videos are named and capped by their short side (1080×1920 is 1080p). HLS switches keep the current stream and buffer playing until the new quality arrives; the label shows the pending quality. MP4 changes and paused HLS changes reload while preserving the position and pause state. Post videos above 1080p play through the post's HLS stream: X declares an impossible frame rate in the video header, which makes the TV skip frames at 4K, and the app corrects it as that stream loads ([details](docs/4k-playback-investigation.md)).
- Green toggles play / pause. Stats for nerds (decoded resolution, source bitrate, codec, buffer, dropped frames, player state) has no on-screen button; the Blue key opens it for troubleshooting. Source bitrate is not an internet speed test.
- Yellow or **Post & comments** opens the full post and paginated public replies while playback continues. Left / Right changes tabs, Up / Down scrolls, and OK loads more replies or retries a failed request. Back closes the panel first.
- Broadcasts also have a **Broadcast chat** tab, separate from post replies. It reads public chat without signing in, refreshes every three seconds while the tab is visible, deduplicates messages, and retains the latest 300. Scrolling up keeps your place; at the bottom it follows new messages. Replays load available chat history. Failed requests show Retry and never interrupt video playback.
- The player controls show **LIVE · N watching** when X supplies a concurrent viewer count, refreshed every 15 seconds. Missing/failed counts show unavailable; ended broadcasts show **Broadcast ended**, without presenting their old count as current. Chat access tokens stay in memory. Chat polling stops when the panel/tab closes; all broadcast requests stop when playback closes. The packaged TV can reach these endpoints directly; browser previews can be restricted by X's cross-origin rules.
- Back first hides the whole overlay, including menus, Posts, and Stats. A second Back with the overlay hidden closes playback and restores the selected card. Holding Back cannot accidentally trigger both steps. Back from History or Search returns to Home.
- The on-screen Back button closes playback immediately, saves progress, and restores the selected card. It also works when selected with the remote and activated with OK.

The player uses bundled hls.js through Media Source Extensions, with native HLS as a fallback. This fixes broadcasts that silently fail in the older TV's native HLS implementation. Bundled Noto fonts, Twemoji SVG emoji, and SVG control icons avoid dependence on missing TV glyphs. Scrollbars and player controls use the dark theme.

Playback automatically recovers from failed or stalled sources: refresh a broadcast link once and try lower available qualities, preserving position, with a maximum of three app recovery attempts. Back and manual quality selection cancel pending recovery. A failed requested HLS quality keeps the current buffered quality playing. Loading and final failure messages are mutually exclusive.

## Live transcription setup

Open **Settings → Live captions** and scan the QR code with a phone. Sign into Groq on its official site, create a personal API key, then paste it into the phone setup page. The TV connects automatically. **Enter a key instead** also supports direct entry in the app. **Disconnect Groq** removes the saved key and stops transcription. Never put a Groq key in `config.js`, the app package, a URL, source control, or a chat.

Each device stores its own key separately from settings and History, in localStorage and the app-owned TV DB8 record. The phone encrypts the key with TweetNaCl secretbox using a random secret carried only in the QR URL fragment. The hosted pairing service cannot read the key. Pairing expires after ten minutes; the encrypted record is deleted after connection/cancellation, and unused expired records are cleaned when new sessions are created. The pairing server handles no stream audio. Its source is in `pairing-service/`; the deployed endpoint is configured by `HELLO_TV.pairingUrl`.

The player reuses hls.js's demuxed audio, assembles short standalone audio files, and sends them directly to Groq's Whisper Large V3 Turbo endpoint. No PC, microphone or audio relay is required. Auto mode prefers supplied subtitle tracks and otherwise transcribes. Off is remembered. Switching streams, closing playback, seeking, disabling captions or disconnecting cancels stale requests. Groq free-tier limits pause caption requests with an automatic retry and never interrupt playback. Actual timing and accuracy depend on the stream and service. Native HLS without hls.js and MP4-only playback do not currently support generated captions.

The setup, encrypted transfer, persistence, audio extraction, caption display, cancellation and rate-limit paths have automated coverage with simulated Groq responses. Hosted pairing was checked anonymously against the deployed service. Actual Groq recognition and the physical TV still require verification using a user's own key.

## Local preview, checks, and TV install

```powershell
npm install
npx playwright install chromium
npm start
```

Open http://127.0.0.1:8080. The preview server serves development files; the installed TV package works independently. A computer keyboard can type search queries; Backspace deletes and Escape goes back.

Drag a saved channel filter on Home before or after another channel to rearrange it. The insertion marker shows where it will land, and the order is saved automatically. Hot, Live and Videos stay at the start.

```powershell
npm test
npm run package
npm run tv:install
npm run tv:launch
```

Version 1.6.0 (the visual redesign) is `dist/com.example.hellotv_1.6.0_all.ipk`, installed and launched on `mytv` on 2026-10-15. All 9 channels, 22 positions and 22 History entries survived. Animations were tuned on the TV itself (webOS 4.5, Chromium 53, interface drawn at 1920×1080): scrolling, menu, filter and channel-selector moves went from 10–25 fps to 48–53 fps with every animation on. On older TV browsers, everything that animates is pre-drawn on its own GPU layer so the animations stay fluid. Evidence: `test-results/tv-motion-check-1.6.0.json`, `test-results/tv-state-after-1.6.0.json` and `test-results/tv-home-1.6.0.png`. All 76 checks pass. The previous package, 1.5.0, was deployed and launched on `mytv` on 2026-10-15. It added broadcast chat and concurrent viewer metadata. All nine saved channels, 21 playback positions, and existing history entries survived. All 67 checks passed, including live chat updates, duplicate/control-message filtering, retries and cancellation, live-to-replay transitions, unavailable/zero viewer counts, escaped chat text, remote tabs, and the existing browsing, storage, playback, quality, recovery, replies, and ES5 checks. Physical-TV verification confirmed the @dotnet replay decoded at 1920×1080 while the Broadcast chat tab successfully loaded an empty history and the audience label correctly said Broadcast ended. A real live message/count update still needs confirmation during another live broadcast. TV commands use the configured alias `mytv`. Evidence: `test-results/tv-broadcast-check-1.5.0.json` and `test-results/tv-broadcast-chat-1.5.0.png`.

Keep every shipped script in ES5 for webOS 4.5 / Chromium 53. Development tests may use modern JavaScript.

Public third-party sources can change or fail; the app displays errors and retry options. No account tokens, cookies, or credentialed X requests are added. See [the source policy review](docs/x-policy-check.md) and [the redesign handover](docs/redesign-handover.md).

Global Trending remains unimplemented under the public-only constraint. On 2026-10-10 the FxEmbed trends endpoint returned US topics, and its video search returned HTTP 404 for a current topic. [Trends24](https://trends24.in/) publishes worldwide topic lists, but does not supply playable X posts/videos or permit direct browser cross-origin reads. [X's worldwide Trends API](https://docs.x.com/x-api/trends/trends-by-woeid/introduction) requires developer credentials. Hot is explicitly scoped to favourites.

Emoji artwork: [Twemoji](https://github.com/jdecked/twemoji), Copyright Twitter and contributors, licensed under CC BY 4.0. Bundled fonts are from [Noto](https://github.com/notofonts/noto-fonts), under SIL OFL 1.1. Dependency versions and licenses are documented in [app/vendor/README.md](app/vendor/README.md).

# Porsche 4K playback investigation — 2026-10-15

TV: configured `mytv`, LG OLED55C9PLA / webOS 4.5. App: 1.6.0.
Clip: Porsche post `2079945544194011444`, 65.75 seconds.

The user reports uneven/slow picture movement while sound continues normally.
The current source was a direct MP4, decoded at 3840×2160. FFprobe reports
H.264 High, Level 5.1, 8-bit 4:2:0, 24000/1001 fps, approximately 17.7 Mbps
video average. These parameters fall within LG's published UHD limits:
https://webostv.developer.lge.com/develop/specifications/video-audio-45

The direct-MP4 sample maintained readyState 4, playbackRate 1 and approximately
10–14 seconds of buffered video. No waiting/stalled events were observed during
the approximately 45-second test. The playback clock advanced normally. The TV
reported zero decoded and dropped frame counters, so these cannot establish
that frames were displayed smoothly. Evidence: `test-results/tv-4k-original.json`.

Comparison on the physical TV:

- Same clip through bundled hls.js/MSE, forced to its 2160p variant: user still
  sees slowdown. Sample confirms 3840×2160 and no hls.js error events. Evidence:
  `test-results/tv-4k-hls.json`.
- Same opening section at 1080p using the app's existing quality selector: user
  confirms smooth motion.
- Back to direct 4K with browse/search/navigation set to display:none and
  animation, transitions and will-change disabled during playback: user still
  sees slowdown. Temporary style removed afterward.

Conclusion: evidence points toward the TV's decode/presentation handling of
this particular 4K H.264 encode. Network starvation was not observed; swapping
playback paths and removing UI graphics overhead did not resolve the symptom.
This does not prove a general inability to play 4K, nor establish the exact
firmware/decoder fault. The tested source playlist supplies AVC, without an
HEVC alternative.

Verified workaround: select 1080p. The clip was left paused at the original
1.583-second position at 1080p. The app already defaults to at most 1080p.
No application code or installed package was changed: there is no verified
software fix retaining 4K from these tests. Temporary HLS playback, sampling
timers, event listeners and graphics overrides were cleaned up.

## Resolved — 2026-11-12

The decoder is not at fault. X writes a nonsense frame rate into the H.264 header
(SPS VUI timing: `num_units_in_tick` 1, `time_scale` 480000, i.e. 240000 fps) while
the MP4 container holds the real 23.976 fps. Every rendition has it. At 1080p the TV
ignores it; at 2160p, where its H.264 decoder is rated for 30 fps, it skips frames.
Nothing is visible to the page: buffer steady at about 12 s, no underflow events from
`com.webos.media`, CPU and memory normal.

Viewer-confirmed on the TV, same clip at 2160p each time:

- All player overlays and page updates removed: still drops frames.
- Unmodified file served from the PC: drops frames.
- Same file, stream-copied with only the VUI timing set to 1001 / 48000: smooth.
- X's own HLS stream through hls.js with the init segment corrected in the page: smooth.

Fix: `app/sps.js` rewrites the timing in the fMP4 init segment from the container's
sample duration (hls.js fragment loader), and qualities above 1080p of a post video
play through the post's HLS stream instead of the MP4 file, which cannot be altered
in flight. X's HLS segments carry no in-band SPS, so the init segment is sufficient.
MPEG-TS streams are not corrected.

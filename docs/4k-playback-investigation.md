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

## SpaceX versus Porsche — follow-up, 2026-11-12

Investigated the user's choppy **Q3 2026 Financial and Operational Results**
replay (SpaceX broadcast `1PKqrNbLZbPGb`, post `2112641741937635789`) against
the smooth **One runway. One Cayenne Turbo Electric.** Porsche post above.
Both were resolved from History on the physical TV, running app 1.7.9.

| Property | SpaceX results replay | Porsche runway clip |
| --- | --- | --- |
| 4K video | 3840×2160, H.264 High, Level 5.1, 8-bit 4:2:0 | Same |
| Actual sample frame rate | 30 fps | 24000/1001 (23.976) fps |
| HLS segment container | MPEG-TS, no separate init segment | Fragmented MP4, separate init segment |
| Original SPS timing (units / scale) | 1 / 2000 | 1 / 480000 |
| Rate calculated as scale / (2 × units) | 1000 fps | 240000 fps |
| Timing reaching Media Source with current correction | Unchanged | 1001 / 48000 (23.976 fps) |

SpaceX's master playlist advertises 29.999 fps and 16 Mbps for 2160p. FFprobe
of the first three TS segments confirms 30 fps from sample timestamps. Its
first six seconds average only 1.81 Mbps including audio and transport overhead;
this is an opening sample, not a bitrate measurement of the whole programme.
FFmpeg `trace_headers` finds `num_units_in_tick=1`, `time_scale=2000`, and
`fixed_frame_rate_flag=0`. Porsche also has `fixed_frame_rate_flag=0`: these
timing-derived rates are not the actual presentation cadence, and the header
alone does not prove why a particular decoder stutters.

The correction gap is reproduced end to end. A local Chromium test played the
real SpaceX TS sample through the bundled hls.js and `HelloSps.loader`, capturing
the video init segment at `SourceBuffer.appendBuffer`. Its SPS still contains
1 / 2000. The loader only intercepts network fragments named `initSegment`;
hls.js generates the TS stream's init segment internally, bypassing that loader
branch. Furthermore, the generated MP4 has no usable default sample duration,
so calling the existing `fixInit` on it also does nothing. Passing both captured
init segments to the **installed TV's** `HelloSps.fixInit` returns no change for
SpaceX and a correction for Porsche.

This is a strong candidate explanation, consistent with the earlier
viewer-confirmed Porsche timing-only fix. It is **not yet a viewer-confirmed
SpaceX fix**: no corrected/original SpaceX A/B was performed on the TV, and this
follow-up did not measure the TV's network buffer during SpaceX playback.
LG lists UHD H.264 support at 3840×2160/30p, High Level 5.1, up to 50 Mbps, so
neither clip's nominal format requires concluding that the TV cannot play 4K:
https://webostv.developer.lge.com/develop/specifications/video-audio-45

A fix needs to cover hls.js-generated TS initialization metadata **before**
it is appended and obtain the real rate from trustworthy sample timing or
matching playlist metadata. Merely calling the existing `fixInit` later will
not work. In bundled hls.js, `FRAG_PARSING_INIT_SEGMENT` fires after
`_bufferInitSegment` has already dispatched the append, so it is too late for
a reliable replacement. Do not change media timestamps, playback speed, or
claim the 4K video has really been converted to a different frame rate.

Evidence (local, ignored `test-results/`): `compare-4k.cjs`,
`spacex-probe.json`, `porsche-probe.json`, `verify-ts-path.cjs`,
`spacex-appended-init.mp4`, `porsche-corrected-init.mp4`, and
`check-installed-sps.js`. No application code or installed package was changed
by this follow-up.

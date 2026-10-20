# X policy check: hello-tv

Checked on 2026-10-10 against the [X Terms of Service](https://x.com/en/tos) (effective October 9, 2026), the [X Developer Policy](https://docs.x.com/developer-terms/policy) and the [Display requirements](https://docs.x.com/developer-terms/display-requirements). This is a reading of X's published text, not legal advice.

## Verdict

- **The current app is not compliant.** It gets X content through channels other than X's published interfaces.
- **Your X account is not exposed by it.** The app never signs in and never sends your cookies, so none of its traffic is tied to your account. The realistic risk is X blocking the requests, not a ban.
- **Logging in on the TV with your X password is not allowed** for third-party apps. The only way to do it without the official API would be to impersonate X's own apps, so it was not built.
- **The compliant route is the official X API** with an app-only Bearer token. It covers video search and channel videos, but it has no endpoint for live video broadcasts.

## Findings

| # | What the app does | Where | Policy |
|---|---|---|---|
| 1 | Downloads `x.com/i/broadcasts/<id>` pages and reads stream URLs out of the HTML, falling back to microlink.io, which fetches the same page | [app/catalog.js:337](../app/catalog.js) `fetchBroadcast` | ToS [§4 Using the Services](https://x.com/en/tos#chapter4) (EU/EFTA/UK version: [§4](https://x.com/en/tos#int-chapter4)): access is allowed only through X's published interfaces, and the note in clause (iii) says *"crawling or scraping the Services in any form, for any purpose … is expressly prohibited"*. The omitted words are "without our prior written consent". |
| 2 | Loads timelines, account suggestions and search from `api.fxtwitter.com`, a third-party service that pulls from X's internal, non-published APIs | [app/catalog.js:102](../app/catalog.js) `findProfiles`, `findVideos`, `fetchList` | Same ToS §4 clause. ToS [§5 Liquidated Damages](https://x.com/en/tos#chapter5) also makes anyone who helps or encourages a violation liable: $15,000 per 1,000,000 posts above 1M posts in 24 hours. Personal TV use is far below that threshold, but this is still use of a non-published interface. |
| 3 | The old PC server embeds X's web-app Bearer token and uses guest tokens against internal `api.x.com/1.1` endpoints | [server/server.js:12](../server/server.js), `ensureGuest`, `resolveBroadcast` | Same ToS §4 clause. The TV app no longer uses this server. Deleting `server/` is recommended. |
| 4 | Post text is rewritten for card titles: links are stripped and text is cut at 160 characters | [app/catalog.js:229](../app/catalog.js) `cleanTitle` | [Display requirements: Post text](https://docs.x.com/developer-terms/display-requirements#post-text): post text must be shown exactly as written. This binds apps that use the X API. |
| 5 | Asked for: logging in on the TV with your X password | not built | [Developer Policy: X passwords](https://docs.x.com/developer-terms/policy#x-passwords): apps may not ask people for their X password or store it. X points to Sign in with X instead. |

## Compliant route: the official X API

- **Sign up and get keys:** [console.x.com](https://console.x.com). Buy credits, create an app, then copy its Bearer token.
- **Pricing:** [docs.x.com/x-api/getting-started/pricing](https://docs.x.com/x-api/getting-started/pricing). Pay-per-use with no subscription. A post read costs $0.005 and a user read $0.010. Reading the same resource again within a 24-hour UTC window is not charged a second time. Reads are capped at 3M posts per month.
- **Search:** [Recent search](https://docs.x.com/x-api/posts/search/introduction), `GET /2/tweets/search/recent`. It covers the last 7 days, returns up to 100 posts per request, supports `has:videos`, and works with an app-only Bearer token (no user login). Requesting `media.fields=variants` returns the MP4/HLS URLs the TV can play directly.
- **Rough cost:** a 20-result video search is about $0.10. Refreshing a home screen with 6 channels × 20 posts is about $0.60, and repeat reads on the same UTC day are free.
- **Gap:** the X API has no endpoint for live video broadcasts. It has Spaces, which are audio only. The app can find posts that link to a live broadcast but cannot play the broadcast without going back to finding 1. Compliant fallback: show the post with a QR code to watch it on X.
- **Display rules to follow on the TV** ([Display requirements](https://docs.x.com/developer-terms/display-requirements)):
  - Show the author's avatar, display name and @username.
  - Show the post text unmodified, with its timestamp.
  - Show the X logo.
  - Offer "View on X" (a QR code to the permalink on a TV).
  - Attach no third-party social actions to posts.
- **Token handling:** the Bearer token ends up inside the app package. Keep the `.ipk` on your own TV and don't share it.

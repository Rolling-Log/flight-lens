# Flight Lens Edge Companion

This unpacked MV3 extension runs domestic OTA page collection in the user's own Edge session.
It communicates only with the local Flight Lens pages on ports `3000` and `3100`, plus the
explicitly allowlisted staging site at `https://flight-lens-staging.netlify.app`.

The web app owns search intent, normalization, price comparison, recommendations, disclosures,
and purchase handoff. Edge Companion is not a standalone metasearch product: it only collects
source-page evidence in the user's existing Edge session and returns it to the local web app.
It does not buy tickets, submit payment, bypass login or verification, or claim a displayed fare
is the final tax-inclusive price when the source does not provide a complete price breakdown.

## Local install

1. Open `edge://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked** and select this directory.
4. Keep the extension enabled, then search from `http://127.0.0.1:3000` or the allowlisted
   Netlify staging site.

After changing any extension source file, return to `edge://extensions` and click **Reload**
on Flight Lens Edge Companion before running another acceptance search. Refreshing the website
alone does not restart the extension service worker or register new content scripts.

Version 0.2.0 streams each platform result independently and supports retrying one platform.
After signing in, return to Flight Lens → Sources and choose **已完成登录／验证，继续**.
Pending login tabs and completed round-trip legs are retained for 30 minutes in extension
session storage, scoped to the initiating Flight Lens tab and exact search conditions.
Closing the browser clears this resumable state. No cookies or passwords are copied.

Qunar collection follows visible “下一页” controls within a 55-second / 30-page / 500-card
budget. Stalled navigation and exhausted budgets return partial evidence. Results are still
city-scoped upstream and matched to exact airports after collection; no claim is made that
all sellers or fare products have been expanded. This pagination path has fixture coverage;
live-page acceptance must be repeated after site changes.

Ctrip adult base fare and combined source tax are preserved separately. Missing,
blank, or invalid tax remains unverified; only an explicit zero represents zero tax.
The API checks that the breakdown equals the displayed amount before admitting it to
verified comparison. Older extension responses without a breakdown remain list prices.
Combined source tax is not a separate airport/fuel breakdown or a checkout confirmation.

When a platform requires login or human verification, its tab remains open and is focused.
Successful and ordinary failed collection tabs are closed automatically.

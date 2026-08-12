# Flight Lens Edge Companion

This unpacked MV3 extension runs domestic OTA page collection in the user's own Edge session.
It communicates only with the local Flight Lens pages on ports `3000` and `3100`.

## Local install

1. Open `edge://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked** and select this directory.
4. Keep the extension enabled, then search from `http://127.0.0.1:3000`.

After changing any extension source file, return to `edge://extensions` and click **Reload**
on Flight Lens Edge Companion before running another acceptance search. Refreshing the website
alone does not restart the extension service worker or register new content scripts.

When a platform requires login or human verification, its tab remains open and is focused.
Successful and ordinary failed collection tabs are closed automatically.

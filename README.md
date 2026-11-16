# Clothes Horse

Customer management app for the Clothes Horse rental closet. It is an installable web app: open it in a browser, then add it to the home screen on an iPad, Android device or computer.

## What's here
- `index.html` — the whole app (screens, rules and on-device saving)
- `manifest.webmanifest`, `icon*` — home-screen name and icon
- `sw.js` — lets the app open without internet

## Data
Records are currently saved on each device (IndexedDB). Cloud sync and backups through Supabase are next. Customer records are never stored in this repository.

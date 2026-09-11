# Privacy Policy

Numera is a natural-language text calculator that runs entirely in your
browser. It is designed to be private by default.

## What we collect

Nothing. Numera does not collect, transmit, or store any of your data on a
server. There are no accounts, no analytics, no advertising, and no tracking.

## Where your data lives

Everything you type — calculations, files, workspaces, and settings — is
stored locally on your device:

- **Workspaces and files** are saved in your browser's IndexedDB storage.
- **Settings and theme preferences** are saved in your browser's
  `localStorage`.
- **Cached exchange rates** (only if you refresh them) are saved in your
  browser's `localStorage`.

None of this data leaves your device, and no one at Numera can access it.

## Third-party services

Numera loads the Roboto and JetBrains Mono fonts from Google Fonts. When the
fonts load, your browser sends a standard request to Google's servers, which
may include your IP address and browser information. See Google's privacy
policy at https://policies.google.com/privacy.

### Exchange rates

Numera can convert between currencies using live exchange rates. This is
strictly opt-in: Numera only contacts `open.er-api.com` when you explicitly
tap **Refresh rates** in Settings. That request asks for the public
USD-based rate table and sends no workspace contents, calculations, files, or
any other user data. Numera does not fetch rates automatically and does not
contact this service on startup.

The last successfully fetched rates are cached locally in your browser's
`localStorage`. If a refresh fails (for example, you are offline), Numera
falls back to that cache, or to the built-in default rates if no cache
exists, so currency conversions keep working without a network connection.

## The calculation engine

Calculations are evaluated locally by a WebAssembly engine bundled with the
app. Your expressions are never sent to a server for processing.

## Data deletion

Because your data never leaves your device, you can delete it at any time by
clearing this site's data in your browser settings.

## Changes

If this policy changes, the updated version will be posted on this page.

## Contact

For privacy questions, open an issue at
https://github.com/Jvcon/Numera/issues.

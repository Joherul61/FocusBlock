# FocusBlock

FocusBlock is a local-first Manifest V3 Chrome extension for temporarily blocking distracting websites. It offers a flexible Focus Mode and a more restrictive Lockdown Mode, with timers, custom sites, session history, and local statistics.

> **Before making this repository public:** Lockdown Mode's 30-entry password pool is hard-coded in `background/background.js`, as designed for this personal tool. Anyone with access to the source can read those values. The list has intentionally been left unchanged for this preparation request. Replace it with non-personal values before publishing publicly if you do not want the current pool disclosed. Lockdown is a commitment aid, not a security boundary.

## Why FocusBlock exists

FocusBlock is intended to make it easier to stay away from selected distractions during a work or study period. It uses Chrome's declarative request rules rather than a continuous JavaScript request interceptor, and keeps session and statistics data in the browser.

## Features

- **Focus Mode:** Start a blocking session and stop it manually at any time.
- **Lockdown Mode:** Prevents normal manual stopping; an early unlock requires the session's randomly chosen four-digit password.
- **Timed sessions:** Select a preset or choose a custom duration from 1 minute through 12 hours. The saved absolute end time is the source of truth.
- **Website blocking:** Select supported social, video, and other built-in websites individually.
- **Custom websites:** Add domains, grant Chrome access, and enable or disable them in Settings.
- **Categories:** Built-in sites are grouped into Social Media and Video.
- **Completion screen:** Shows whether a session completed naturally or was manually stopped, its elapsed time, and the selected sites.
- **Local statistics:** Tracks completed sessions, focus minutes, mode totals, manually stopped sessions, daily totals, and a consecutive-day completion streak.
- **Session recovery:** The background worker restores dynamic blocking rules and the expiration alarm from saved session state.
- **No account or backend:** Settings, sessions, and statistics are stored locally with `chrome.storage.local`.

### Focus Mode

Choose websites and a duration, select Focus Mode, and start. The active popup shows the remaining time and a **Stop Focus** control. Stopping immediately removes the session's dynamic blocking rule and records the session as manually stopped.

### Lockdown Mode

Choose websites and a duration, select Lockdown Mode, and start. There is no normal stop control in the active UI. **Attempt Unlock** opens a four-digit password form. Incorrect passwords do not end the session; a correct password ends it early. Natural expiration does not require a password.

The extension selects one entry from the 30-element `LOCKDOWN_PASSWORDS` array using `crypto.getRandomValues()` and unbiased index selection. It stores a SHA-256 hash for verification rather than the selected plaintext, and does not include the hash in session data returned to the popup. The password list itself is in the extension source, so this is not cryptographically secure authentication and should not be used to protect valuable resources.

### Timed sessions and website blocking

The service worker saves an absolute `endTime`, selected sites, mode, and other session state in `chrome.storage.local`. It creates a `chrome.alarms` alarm to handle expiration independently of the popup. The popup calculates its display from `endTime - Date.now()`.

While a session is active, one dynamic `declarativeNetRequest` rule redirects selected **main-frame navigations** to the local blocked page. The rule is removed when the session ends. Built-in domains include Facebook, Instagram, YouTube, TikTok, Reddit, LinkedIn, and X/Twitter.

Custom domains require optional host access. Chrome displays a permission prompt when you add or enable a custom website. The extension stores the domain list locally and uses only the granted domains selected for a session.

### Statistics and streaks

Statistics are updated when a session is finalized and remain on the device. “Today” follows the computer's local calendar date. A streak counts consecutive local calendar days with at least one naturally completed session; the streak remains current if the most recent completion was today or yesterday. A statistics reset requires confirmation and does not stop or delete an active session.

## Privacy

- No analytics, advertising, tracking, accounts, or cloud synchronization are included.
- Session, settings, custom-domain configuration, and statistics are stored in Chrome local extension storage.
- The only `fetch()` calls load the extension's packaged `rules/rules.json`; there are no remote service requests.
- Built-in host permissions are declared in the manifest. Custom host access is optional and requested for user-added domains.
- The Lockdown password list is part of the source code. Do not publish personal values in it.

## Technology

- HTML
- CSS
- Vanilla JavaScript
- Chrome Extension APIs
- Manifest V3

There is no Node.js, npm, framework, database, or backend requirement.

## Project structure

```text
FocusBlock/
├── manifest.json
├── background/
│   └── background.js
├── blocked/
│   ├── blocked.html
│   ├── blocked.css
│   └── blocked.js
├── icons/
│   ├── focusblock-16.png
│   ├── focusblock-32.png
│   ├── focusblock-48.png
│   └── focusblock-128.png
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── rules/
│   └── rules.json
├── README.md
└── .gitignore
```

The optional `release-package/` directory and `FocusBlock-*.zip` archive are generated distribution artifacts, not the development source of record, and are excluded from Git. Load the project root, where `manifest.json` lives.

## Install and load locally

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository's `FocusBlock` project folder (the folder containing the root `manifest.json`).
6. Pin FocusBlock from Chrome's Extensions menu if desired.

To apply code changes, return to `chrome://extensions` and click the extension's **Reload** button. Reopen the popup after reloading.

## Use Focus Mode

1. Open the FocusBlock popup.
2. Select one or more built-in or enabled custom websites.
3. Choose a preset or custom duration.
4. Select **Focus Mode** and start the session.
5. Reopen the popup at any time to view the remaining time.
6. Choose **Stop Focus** to finish early.

## Use Lockdown Mode

1. Add custom websites in **Settings** first, if needed, and grant Chrome's requested access.
2. Open the popup and select the websites and duration.
3. Select **Lockdown Mode** and start the session.
4. Use the timer to track progress. To end early, choose **Attempt Unlock** and enter the selected four-digit password.
5. The session also ends automatically when its timer expires.

### Replacing the 30-password pool

The pool is the `LOCKDOWN_PASSWORDS` constant near the top of `background/background.js`. Replace its contents with exactly 30 unique four-digit strings. The worker checks that there are exactly 30 entries and that each is four digits. Keep the values private if the repository will be public. The code intentionally does not provide a password-selection or password-management UI.

## Development

No package installation or build step is needed.

- Edit the existing HTML, CSS, JavaScript, manifest, or local JSON configuration.
- Keep extension-page scripts local; do not add remote script dependencies.
- Add a built-in website by updating its entry in `rules/rules.json` and adding the corresponding host pattern to `manifest.json`.
- Custom website permissions are requested by the Settings page at runtime.
- Reload the unpacked extension in `chrome://extensions` after code or manifest changes.
- Check the service worker's **Inspect views** console for runtime errors when debugging. Do not log or expose the selected Lockdown password.

## Testing status

The project has had static manifest/reference checks, editor diagnostics, and browser-driven workflow checks using mocked Chrome APIs. These checks exercised session start/stop, Lockdown password verification, dynamic-rule construction, timer/expiry logic, state recovery, settings, custom websites, and statistics.

**A complete live test in Chrome has not been confirmed.** In particular, live unpacked installation, live site navigation blocking, actual Chrome permission prompts, and real alarm delivery/browser-restart behavior still need manual verification before release.

## Known limitations

- Blocking applies to main-frame navigation. A tab that was already open, in-page navigation, or some single-page-app transitions may not be blocked.
- DNR redirects to the local blocked page without preserving the original destination. After a session ends, reload or revisit the site.
- Chrome alarms can be delayed, particularly while a device is asleep. The stored end time is authoritative and is checked when the worker runs again.
- Custom-site access uses broad optional host access to support arbitrary user-entered domains, while requesting permission for individual domains when needed.
- Statistics are finalized when a session ends; a session in progress is not continuously added to totals.
- The hard-coded password pool can be inspected in source and the extension can be modified or disabled by its owner. Lockdown is a productivity commitment mechanism, not an anti-tampering control.
- Site availability and subdomain coverage can change independently of the extension.

## Future improvements

Possible follow-up work includes live Chrome acceptance tests, a more automated rule-validation suite, configurable site categories, and improved handling of already-open tabs where Chrome's APIs permit it.

## License

No license file is currently included. Until a license is added, the project is not explicitly licensed for reuse, redistribution, or modification by others. Choose and add a license before inviting public contributions or granting reuse rights.

# Privacy policy — ADHD Review

ADHD Review is a Chrome extension that helps you review GitHub pull requests on the "Files changed" page. It is built and published by Ervan Lefèvre and has no server of its own.

## What the extension stores

- **Your GitHub personal access token**, which you paste in the extension options. It is kept in the extension's local storage of your browser profile (`chrome.storage.local`). It is never synced to other devices, never sent anywhere except `https://api.github.com`, and is deleted when you clear it in the options or uninstall the extension.
- **Review notes, "later" flags and settings** (review order rules, keyboard shortcuts, line cap, whether the sidebar is open), also in the extension's local storage, keyed by pull request. They never leave your browser.
- **A short-lived cache** of the pull request data fetched from GitHub (file list, line counts, viewed state, your pending review comments), in the extension's session storage, cleared when the browser closes.

## What the extension sends

Requests go only to `https://api.github.com` (GraphQL), authenticated with your token, to:

- read the pull request you have open: its files, their change counts, which ones you have marked as viewed, and the comments of your pending review;
- mark a file as viewed or not viewed, when you ask for it;
- submit your review with the global comment you typed, when you click one of the submit buttons.

The extension also reads and interacts with the GitHub pull request page you have open (`https://github.com/*/*/pull/*`) to show its bar and sidebar, scroll to files and tick GitHub's own "Viewed" checkbox.

## What the extension does not do

- No analytics, telemetry, crash reporting or tracking of any kind.
- No data is sent to the author or to any third party.
- No data is sold, shared or used for advertising.
- No access to pages other than GitHub pull request pages.

## Changes and contact

Changes to this policy are published in this repository. Questions: open an issue at https://github.com/ervanlefevre/adhd-review/issues.

Last updated: 2026-10-27.

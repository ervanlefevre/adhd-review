# Privacy policy — ADHD Review

ADHD Review is a Chrome extension that helps you review GitHub pull requests on the "Files changed" page and GitLab merge requests on the "Changes" page. It is built and published by Ervan Lefèvre and has no server of its own.

## What the extension stores

- **Your GitHub and/or GitLab personal access tokens**, which you paste in the extension options. They are kept in the extension's local storage of your browser profile (`chrome.storage.local`). They are never synced to other devices, never sent anywhere except `https://api.github.com` (GitHub token) and `https://gitlab.com/api` (GitLab token), and are deleted when you clear them in the options or uninstall the extension.
- **Review notes, "later" flags and settings** (review order rules, keyboard shortcuts, line cap, whether the sidebar is open), also in the extension's local storage, keyed by pull request. They never leave your browser.
- **A short-lived cache** of the pull request or merge request data (file list, line counts, viewed state, your pending review comments or draft notes), in the extension's session storage, cleared when the browser closes.

## What the extension sends

On GitHub, requests go only to `https://api.github.com` (GraphQL), authenticated with your GitHub token, to:

- read the pull request you have open: its files, their change counts, which ones you have marked as viewed, and the comments of your pending review;
- mark a file as viewed or not viewed, when you ask for it;
- submit your review with the global comment you typed, when you click one of the submit buttons.

On GitLab, the file list and the viewed state are read from the merge request page itself (its own metadata endpoint and the "viewed" list GitLab keeps in your browser's local storage); no token is needed for that. With a GitLab token, requests go only to `https://gitlab.com/api/v4` to list your draft notes on the merge request and, when you click a submit button, publish them, approve, or post the summary you typed.

The extension also reads and interacts with the pull request or merge request page you have open (`https://github.com/*/*/pull/*`, `https://gitlab.com/*/-/merge_requests/*`) to show its bar and sidebar, scroll to files and tick the page's own "Viewed" checkbox.

## What the extension does not do

- No analytics, telemetry, crash reporting or tracking of any kind.
- No data is sent to the author or to any third party.
- No data is sold, shared or used for advertising.
- No access to pages other than GitHub pull request and GitLab merge request pages.

## Changes and contact

Changes to this policy are published in this repository. Questions: open an issue at https://github.com/ervanlefevre/adhd-review/issues.

Last updated: 2026-10-27.

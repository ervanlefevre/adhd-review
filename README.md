# ADHD Review

A Chrome extension that paces large GitHub pull request reviews. GitHub stays the diff viewer; the extension adds a pacing layer on top of the **Files changed** page:

- **Review order by domain**: files are grouped by path rules (migrations → models → … → locales → specs) and `j`/`k` walk that order, not GitHub's alphabetical one.
- **Keyboard review**: `v` marks the file viewed (GitHub's own checkbox) and jumps to the next pending file, `l` flags it for later, `n` jumps to the next pending file, `G` marks the whole current group viewed (one keystroke for the ten auto-translated locale files).
- **Context bar** at the bottom of the viewport: current group and position, full path (click to copy), viewed / later status, lines-weighted progress.
- **Review sidebar** (`o`, the round icon at the bottom right, the Panel button in the bar, or resting the mouse on the right edge of the window) docked on the right over the full window height, pushing the page; it stays open across pages until closed with × or `o`. The toolbar icon opens the same panel as a native Chrome side panel. It shows per-group progress with clickable file list, a notes scratchpad per pull request (`alt+n` adds a line for the current file), and a **wrap-up** tab that gathers the pending review comments, the notes and the "later" files next to the global comment and the Comment / Approve / Request changes buttons.

All data (file list, line counts, viewed state, pending review) comes from the GitHub GraphQL API; the page DOM is only used to scroll to a file and click its "Viewed" checkbox, so it also works with GitHub's virtualized mode for large pull requests.

## Install (unpacked)

1. Get the files: either clone this repository, or download `adhd-review-<version>.zip` from the [releases page](../../releases) and unzip it.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick the folder.
3. Create a GitHub token: **Settings → Developer settings → Personal access tokens → Tokens (classic)**, scope `repo`. If the organization enforces SAML SSO, use **Configure SSO → Authorize** on the token.
4. Open the extension options (right-click the toolbar icon → Options), paste the token, **Test connection**, **Save**.
5. Open a pull request's **Files changed** tab. The bar appears at the bottom with a round panel icon above it; press `?` for the keys.

The token is stored in `chrome.storage.local` of this profile only and is sent to `api.github.com` only. See [PRIVACY.md](PRIVACY.md).

## Keys

| Key | Action |
|---|---|
| `j` / `k` | next / previous file in review order |
| `v` | mark viewed and go to the next pending file |
| `u` | unmark viewed (stays on the file) |
| `l` | flag for later and move on (again to unflag) |
| `n` | next file neither viewed nor flagged |
| `G` | mark every remaining file of the current group as viewed |
| `o` | toggle the review panel (in-page drawer) |
| `alt+n` | add a note line for the current file |
| `r` | refresh from GitHub |
| `?` | show the keys |

Keys are configurable in the options and ignored while typing in a field. They also work while the sidebar has the focus (outside its text fields); `Escape` in the sidebar hands the focus back to the page, and so does jumping to a file from it. The sidebar's file list hides the part of the path its group rule matched; the full path is in the tooltip and in the bar.

## Review order and progress

Rules live in the options, one per line: `Label | regex | weight`. A file belongs to the first matching rule; the rule order is the review order; unmatched files go to "Other". Progress is `Σ weight(viewed) / Σ weight(all)` with `weight = min(changed lines, line cap) × group weight`, so a 2 000-line generated file counts like a 150-line one and the auto-translated locales (weight 0.1) barely move the bar.

## Development

- No build step: plain ES modules. `src/content/content.js` is the classic content script that imports `src/content/page.js` as a module.
- `npm run package` builds the shareable zip in `dist/` (`bin/package poc` adds a suffix); `bin/package --store` builds the flat zip the Chrome Web Store expects (manifest at the root).
- `npm test` runs the pure model tests (`src/review_model.js`, `src/rules.js`) with `node --test`.
- GitHub's new "Files changed" page is a React application with generated class names. `src/content/dom.js` therefore locates file blocks from two stable facts, a checkbox labelled "Viewed" and the file path as text, with a fast path on `data-path` for the classic page. Anchors use GitHub's `#diff-<sha256(path)>` convention.
- After editing, reload the extension in `chrome://extensions` and reload the pull request page.

## Later

- Per-commit visualization: review a pull request commit by commit, with the same order, progress and keys scoped to one commit at a time.

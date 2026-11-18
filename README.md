# tabFORGE - built for fast editing, structured outlining, and multi-document workflows.

## Neat Features

- Tab-based editing
- Create, import, and manage multiple text files
- Export current tab or all tabs as a ZIP
- Print current tab
- Grow word selections with repeated double-clicks
- Whole-line selection, moving, and nested folding
- Manual save, save all, restore to last save
- Undo and redo
- Autosave with local storage persistence
- Search and replace
- Fuzzy search
- Find matches across tabs
- Line numbers
- Zebra mode
- Word wrap
- Zoom controls
- Magic outline mode
- Outline level filtering
- Hide completed lines
- Single and multi-view layouts
- Theme support with accent color customization
- Special markup highlighting for:
  - `!!`
  - `??`
  - `--`
  - `**`
  - `DONE`
  - `@mentions`
  - `#tags`

## Getting Started

1. Clone the repository
2. Open `index.html` in your browser

The app includes its generated CSS, icon bundle, and ZIP library. Opening the HTML file needs no build, server, or external asset requests.

The single 44-pixel header holds Save, Undo, Redo, Outline, Wrap, Find, and Settings. View contains Hide DONE, outline-level filtering, and multi-view layout. At narrow widths, Outline and Wrap also move into View. The 24-pixel bottom bar keeps the save status and all document statistics; it scrolls horizontally when they do not fit. Top and side tabs remain available. Compared with the former separate toolbar, the editor gains 98 pixels without changing text size.

## In-app feature reference

Open the gear and select **Features** beside **Preferences** for the current version and an expandable outline of the available controls, shortcuts, and gestures. Open a category, then a feature to read its instructions. Nested folds retain their state when a parent is closed and reopened. Use Expand all or Collapse all to change the whole outline. Search by an action, keyword, or shortcut; matching branches open automatically, and clearing search restores your folds. Ctrl+F inside Settings opens the guide search, and Escape closes Settings. On Mac, Cmd shortcuts match their Ctrl equivalents in the guide.

The inventory lives in `feature-catalog.js`, separately from its UI in `feature-guide.js`, so descriptions can be refined without changing editor behavior. Keep this inventory aligned with user-accessible features when adding or changing a command.

## Selecting, moving, and folding lines

Click a line number to select its whole row. Shift-click or Shift+Up/Down extends or shrinks the range from the original anchor; Ctrl/Meta-click toggles individual rows. Enter or F2 returns to text editing. Copy, cut, paste, Delete, Tab, and undo/redo work with the selected lines.

Drag a line number at least six pixels to move its contiguous selection. Grabbing an already selected number keeps the range. A selected parent carries all its indented descendants, including collapsed children, and the insertion marker shows the destination. Drop outside the source editor or press Escape to cancel. Moves preserve indentation and fold state and can be undone.

Use the separate arrow beside a parent line number to collapse or expand its descendants, even when it has just one child. A collapsed parent shows how many lines are hidden. Nested folds retain their state through insertions, deletions, splits, merges, and moves. The arrows also work from the keyboard and remain available when line numbers are hidden.

## Development checks

Use Node.js 24 for development and CI. Install the pinned tooling and Chromium once:

```sh
npm ci
npx playwright install chromium
```

Run the checks:

```sh
npm test
npm run test:browser
npm run check
npm run benchmark
```

`npm run check` runs both the unit and browser suites. Browser checks cover real clicks, keyboard focus, folds during editing, undo/redo, themes, wrapping, multiple panes, and a 5,000-line selection that must keep the existing DOM. Layout checks cover the recovered editor space, bottom statistics, and compact commands at widths from 320 to 1280 pixels. They also open `index.html` directly and reject external asset requests. Set `HEADED=1` to watch the browser. Screenshots, including a failure screenshot when needed, go in the ignored `output/playwright/` directory. GitHub Actions runs the suites on pushes and pull requests to `tabforge-lite`.

The benchmark measures cached search/statistics reads and 5,000 selected-line membership checks. To compare another version of the app, run `node scripts/benchmark.cjs /path/to/app.js`.

## Styles and production assets

`styles.css` owns the application chrome and theme variables. `editor.css` owns editor rows, gutters, folding, selection, and drag states in that order. The editor states do not depend on later global overrides.

Run `npm run build` after changing utility classes or icon names in `index.html` or `app.js`. It generates `assets/utilities.css`, a bundle of only the Lucide icons in use, and local ZIP support, with dependency licenses. Commit `assets/` with source changes so direct HTML opening continues to work. Exact development dependency versions and `package-lock.json` make the build reproducible. Multi-view grid classes are explicitly listed in `tailwind.config.cjs` because they are assembled dynamically.

The build also stages the app's runtime files in the ignored `dist/` directory. Netlify runs the build and unit tests before publishing only that directory; browser checks run in GitHub Actions.

The release number comes from `package.json`. `npm run build` generates the committed `assets/release.js` used by the Features tab. Bump the package version for a release, for example with `npm version patch --no-git-tag-version`, and rebuild; the metadata test checks that the displayed version stays aligned with the package. This release number is independent of the browser-storage schema.

Autosave waits for 500 ms of inactivity and flushes at least every two seconds during continuous editing, as well as when the page is hidden or closed. A complete recovery snapshot is committed before the legacy storage keys; startup prefers this snapshot so interrupted writes cannot mix workspace versions. Storage failures remain visible in the status bar until a later save succeeds. Browser storage limits still apply, and text/ZIP exports provide portable backups.

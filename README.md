# tabFORGE - built for fast editing, structured outlining, and multi-document workflows.

## Neat Features

- Tab-based editing
- Create, duplicate, import, and manage multiple text files
- Export current tab or all tabs as a ZIP
- Print current tab
- Copy current view
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
- Text case transformations
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

That is it.

## Selecting, moving, and folding lines

Click a line number to select its whole row. Shift-click or Shift+Up/Down extends or shrinks the range from the original anchor; Ctrl/Meta-click toggles individual rows. Enter or F2 returns to text editing. Copy, cut, paste, Delete, Tab, and undo/redo work with the selected lines.

Drag a line number at least six pixels to move its contiguous selection. Grabbing an already selected number keeps the range. A selected parent carries all its indented descendants, including collapsed children, and the insertion marker shows the destination. Drop outside the source editor or press Escape to cancel. Moves preserve indentation and fold state and can be undone.

Use the separate arrow beside a parent line number to collapse or expand its descendants, even when it has just one child. Nested folds retain their state. The arrows also work from the keyboard and remain available when line numbers are hidden.

## Development checks

Node.js 18 or newer is needed only for the checks; the app still runs directly in a browser without a build or installed dependencies.

```sh
npm test
npm run benchmark
```

The regression suite covers render scheduling, undo/redo, search, cache invalidation, malformed saved data, interrupted storage writes, gutter selection, keyboard ranges, subtree moves, drag cancellation, and nested folding. The benchmark measures repeated search lookups and outline-statistics reads on a 2,000-line document. To compare another version of the app, run `node scripts/benchmark.cjs /path/to/app.js`.

Autosave waits for 500 ms of inactivity and flushes at least every two seconds during continuous editing, as well as when the page is hidden or closed. A complete recovery snapshot is committed before the legacy storage keys; startup prefers this snapshot so interrupted writes cannot mix workspace versions. Storage failures remain visible in the status bar until a later save succeeds. Browser storage limits still apply, and text/ZIP exports provide portable backups.

(function (global) {
    const categories = [
        {
            id: 'selection', title: 'Selecting and moving text', features: [
                {
                    id: 'grow-word-selection', title: 'Grow a word selection', location: 'In the editor',
                    description: 'Double-click a word to select it. Double-click inside that selection again to add the next word on the same line. Keep double-clicking inside the selection to grow it one word at a time.',
                    example: 'one two three → select “one” → double-click again → “one two”',
                    shortcuts: ['Double-click', 'Double-click again'], keywords: ['word selection', 'repeat click', 'next word']
                },
                {
                    id: 'select-lines', title: 'Select whole lines', location: 'Line-number gutter',
                    description: 'Click a line number to select its entire row. Shift-click another number to select a continuous range. Ctrl-click numbers to add or remove individual, non-adjacent rows.',
                    shortcuts: ['Click a line number', 'Shift+click', 'Ctrl+click'], keywords: ['gutter', 'multiple rows', 'disjoint', 'sparse']
                },
                {
                    id: 'keyboard-range', title: 'Extend, shrink, and reverse a line selection', location: 'After clicking a line number',
                    description: 'Hold Shift and press Up or Down to change the range immediately. The first selected line stays the anchor, so reversing direction shrinks the range and then extends it the other way. Enter, F2, or Escape returns to text editing.',
                    shortcuts: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Enter', 'F2', 'Escape'], keywords: ['keyboard range', 'anchor', 'reverse']
                },
                {
                    id: 'edit-selected-lines', title: 'Copy, cut, replace, or delete selected lines', location: 'With whole rows selected',
                    description: 'Copy and cut use the selected rows, including their indentation. Paste replaces the selected rows; multiline pasted text creates multiple lines. Delete or Backspace removes the selected rows. In ordinary text editing, Enter splits a line, while Backspace at its start or Delete at its end can join neighboring lines.',
                    shortcuts: ['Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Delete', 'Backspace'], keywords: ['clipboard', 'paste', 'split', 'merge', 'join']
                },
                {
                    id: 'move-lines', title: 'Move lines and their children', location: 'Drag a line number',
                    description: 'Drag a line number to move that line or its selected contiguous block. Grabbing an already selected number keeps the range intact. A selected parent carries all its indented descendants, including collapsed children. Indentation and nested fold states travel with the lines. With rows selected, Shift-dragging their text also moves the block.',
                    shortcuts: ['Drag a line number', 'Shift+drag selected text'], keywords: ['reorder', 'moving lines', 'drag and drop', 'parent', 'subtree', 'hidden children']
                },
                {
                    id: 'drop-and-cancel', title: 'Choose a drop position or cancel a move', location: 'While dragging lines',
                    description: 'The insertion marker shows where the block will land. Dropping below a collapsed parent places the block after its hidden descendants. Press Escape or drop outside the source editor to cancel. A completed move can be undone and redone.',
                    shortcuts: ['Escape', 'Ctrl+Z', 'Ctrl+Y'], keywords: ['insertion marker', 'cancel drag', 'drop target']
                },
                {
                    id: 'indent-lines', title: 'Indent and outdent', location: 'Editor or selected rows',
                    description: 'Select whole lines, then press Tab to indent or Shift+Tab to outdent. In Magic outline mode, changing an item’s level updates its outline markers; Tab on a parent can include its descendants. In plain text editing, Tab inserts a tab at the caret. Backspace at the start of an indented line removes one indentation level first.',
                    shortcuts: ['Tab', 'Shift+Tab'], keywords: ['nest', 'depth', 'promote', 'demote', 'indentation']
                }
            ]
        },
        {
            id: 'outline', title: 'Outlines, folding, and markup', features: [
                {
                    id: 'magic-outline', title: 'Magic outline mode', location: 'Header → Outline; View on narrow windows',
                    description: 'Enable Outline for list-aware editing. The editor recognizes numbered, lettered, Roman-numeral, and bullet markers. Enter continues a recognized list item, and Tab or Shift+Tab changes outline depth and updates markers. Indentation defines the parent–child structure; guide lines make nested levels easier to follow.',
                    example: 'I. Main topic\n\tA. Subtopic\n\t\t1. Detail',
                    shortcuts: ['Enter', 'Tab', 'Shift+Tab'], keywords: ['outlining', 'numbering', 'roman', 'bullets', 'list continuation']
                },
                {
                    id: 'fold-branches', title: 'Collapse and expand a branch', location: 'Arrow beside a parent’s line number',
                    description: 'Click the separate arrow to hide or reveal all indented descendants, even if there is only one child. The hidden-line count shows how much is folded away. Nested folds retain their state when reopened, edited around, or moved. Folding arrows remain available with line numbers hidden; leaf lines have no active arrow.',
                    shortcuts: ['Click the fold arrow', 'Enter or Space on a focused arrow'], keywords: ['folding', 'collapse', 'expand', 'hidden children', 'nested']
                },
                {
                    id: 'outline-levels', title: 'Show only selected outline levels', location: 'View → Outline levels',
                    description: 'With Outline enabled, click Outline levels to cycle through Level 1, deeper available levels, and All levels. This changes the visible depth without deleting text. Returning to All levels also clears manual folds so the document is expanded.',
                    keywords: ['level filter', 'depth filter', 'all levels', 'expand all']
                },
                {
                    id: 'hide-done', title: 'Mark and hide completed lines', location: 'View → Hide DONE',
                    description: 'Write DONE in uppercase as a separate word to mark a line complete. Its highlight uses your DONE color. Hide DONE removes completed rows from the current view while keeping their text in the document; toggle it off to show them again.',
                    example: 'DONE Send the draft', keywords: ['completed', 'tasks', 'finished', 'filter']
                },
                {
                    id: 'markup', title: 'Highlight attention markers, mentions, and tags', location: 'Write directly in your text',
                    description: 'Use !! for urgent, ?? for questions, ** for important, -- for deferred, and DONE for completed lines. @mentions and #tags receive inline highlights. These markers also appear in the right-hand document minimap. Choose their colors under Preferences → Special Markup Colors.',
                    example: '!! Follow up with @Alex about #launch', keywords: ['urgent', 'question', 'important', 'defer', 'mention', 'tag', 'special markup']
                }
            ]
        },
        {
            id: 'documents', title: 'Documents and workspace views', features: [
                {
                    id: 'new-import', title: 'Create and import text files', location: '+ beside the tabs; File → Import text files',
                    description: 'Use + to create a document. Import one or several .txt files to open each in its own tab. Click a tab to make it the active document; editing and per-document view controls follow that tab.',
                    keywords: ['new file', 'open file', 'multiple files', 'tabs']
                },
                {
                    id: 'rename-tabs', title: 'Name and rename a document', location: 'Tab title',
                    description: 'A new document takes its initial name from its first line. To choose a name, hover over the tab title briefly until the cursor changes, then click. Enter accepts the name; Escape cancels. Text exports use the document’s name with a .txt extension.',
                    shortcuts: ['Hover, then click', 'Enter', 'Escape'], keywords: ['rename', 'filename', 'title']
                },
                {
                    id: 'reorder-close-tabs', title: 'Reorder, close, and reopen tabs', location: 'Tab strip or side tabs',
                    description: 'Drag a tab onto another to change document order. Click its × to close it. Closing a tab is undoable, so Undo can reopen it. The last remaining document stays open.',
                    shortcuts: ['Drag a tab', 'Ctrl+Z'], keywords: ['reopen', 'closed tab', 'tab order']
                },
                {
                    id: 'multi-view', title: 'Edit up to four documents together', location: 'Document icon on each tab; View → layout',
                    description: 'Click the document icon beside a tab title to add or remove it from multi-view. Numbers on selected tabs show pane order. Choose two to four tabs, then use View’s layout control to cycle between Vertical view (side by side), Horizontal view (stacked), and Grid view. Fewer than two selected tabs returns to a single editor.',
                    keywords: ['multiple panes', 'split view', 'side by side', 'grid', 'horizontal', 'vertical']
                },
                {
                    id: 'compact-workspace', title: 'Keep more editor rows visible', location: 'Compact header and bottom status bar',
                    description: 'Save, Undo, Redo, Outline, and Wrap share one header row. View contains secondary controls; Outline and Wrap also move there in narrow windows. Document statistics stay at the bottom. The compact layout recovers about four text rows at normal zoom without shrinking editor text.',
                    keywords: ['ribbon', 'toolbar', 'screen space', 'compact', 'responsive']
                }
            ]
        },
        {
            id: 'find', title: 'Finding and navigating', features: [
                {
                    id: 'find-text', title: 'Find text and step through matches', location: 'Search icon or Edit → Find and replace',
                    description: 'Open Find and type a query to highlight matches in the active document. Enter in the Find field, F3, or the next-match button advances through results and wraps around. Counts show current-tab matches and matches in other open tabs; switch tabs to search those documents. Escape in Find closes the search panel.',
                    shortcuts: ['Ctrl+F', 'Enter', 'F3', 'Escape'], keywords: ['search', 'next match', 'other tabs']
                },
                {
                    id: 'replace-text', title: 'Replace one match or all matches', location: 'Find and replace panel',
                    description: 'Ctrl+H opens the panel with the Replace field focused. Replace Current changes the selected match; Enter in the Replace field does the same. Replace All applies to the active document. Replacements are undoable.',
                    shortcuts: ['Ctrl+H', 'Enter', 'Ctrl+Z'], keywords: ['replace current', 'replace all', 'search and replace']
                },
                {
                    id: 'fuzzy-find', title: 'Find similar spellings', location: 'Find panel → Fuzzy',
                    description: 'Enable Fuzzy to find similar words when the spelling is not exact. Use a query of at least three characters. Fuzzy matches are highlighted and can be stepped through with the same next-match controls.',
                    keywords: ['fuzzy search', 'typo', 'approximate', 'spelling']
                },
                {
                    id: 'marker-minimap', title: 'Jump through marked lines and scroll quickly', location: 'Right-hand document minimap',
                    description: 'Colored markers locate attention flags, mentions, and tags. Click a marker to jump to its line; folds and filters are adjusted when needed to reveal it. Click an empty part of the rail to jump through the document, or drag its scroll thumb.',
                    keywords: ['navigation', 'minimap', 'scrollbar', 'rail', 'marked lines']
                }
            ]
        },
        {
            id: 'save-export', title: 'Saving, history, and exporting', features: [
                {
                    id: 'autosave', title: 'Resume work with browser autosave', location: 'Automatic; bottom save status',
                    description: 'Edits, open documents, and preferences are saved in this browser as you work. The bottom status reports saving progress or a save failure. This is local browser storage, so export files for portable backups and for use in another browser or computer.',
                    keywords: ['local storage', 'offline', 'persistence', 'recovery', 'backup']
                },
                {
                    id: 'save-revision', title: 'Save a revision or save all tabs', location: 'Save icon; File → Save all',
                    description: 'Save marks the current contents as the document’s saved revision. Ctrl+S does the same. Save all marks revisions for every open tab. Orange gutter marks show lines that differ from the saved revision, and the bottom status shows whether a revision is pending. Use Export to create downloadable files.',
                    shortcuts: ['Ctrl+S'], keywords: ['manual save', 'checkpoint', 'revision', 'dirty', 'orange gutter']
                },
                {
                    id: 'restore-revision', title: 'Restore the last saved revision', location: 'File → Restore last save',
                    description: 'Restore the active document to its last manually saved revision. The command is available when the document has changed since that save. Restoring is itself undoable.',
                    shortcuts: ['Ctrl+Z'], keywords: ['restore', 'revert text', 'last save', 'jump back']
                },
                {
                    id: 'undo-redo', title: 'Undo and redo across documents', location: 'Header or Edit menu',
                    description: 'Undo and redo text edits, indentation, line moves, folding changes, and tab closures. History follows your actions across documents, so Undo may return to the tab where the last action happened.',
                    shortcuts: ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z'], keywords: ['history', 'reopen tab']
                },
                {
                    id: 'export-current', title: 'Download the current text file', location: 'File → Export current tab',
                    description: 'Download the active document as a .txt file. The export includes the full text, including folded or filtered lines. Exporting also marks that document’s current contents as saved.',
                    keywords: ['download', 'text file', 'export single']
                },
                {
                    id: 'export-all', title: 'Export all open documents', location: 'File → Export all tabs',
                    description: 'With ZIP export off, supported browsers let you choose a folder for all open text files. Existing filenames in that folder get a numbered suffix instead of being overwritten. Other browsers use separate downloads. Successful export marks the open documents as saved.',
                    keywords: ['folder export', 'directory', 'multiple downloads', 'all files']
                },
                {
                    id: 'zip-and-filenames', title: 'Package a ZIP or date your exports', location: 'Preferences → Export Preferences',
                    description: 'Enable ZIP export, then choose File → Export all tabs to download one archive. Enable date/time filenames to append a timestamp to exports. These preferences change exported filenames and packaging while keeping your tab titles.',
                    keywords: ['zip archive', 'timestamp', 'date time', 'filename']
                },
                {
                    id: 'print', title: 'Print the full current document', location: 'File → Print',
                    description: 'Print the active document, including lines hidden by folds or filters. Turn on Include line numbers under Preferences → Print Preferences when you want numbered output. The browser’s print dialog provides its available printer and PDF options.',
                    keywords: ['printing', 'pdf', 'paper', 'print line numbers']
                }
            ]
        },
        {
            id: 'appearance', title: 'Appearance and document information', features: [
                {
                    id: 'themes', title: 'Choose a theme and accent color', location: 'Preferences → Interface Theme and Accent Color',
                    description: 'Choose Default, Dark, or Matrix. Set an accent with the color picker or a six-digit hex value. Appearance preferences are remembered in this browser.',
                    keywords: ['light theme', 'dark mode', 'matrix', 'hex', 'colors']
                },
                {
                    id: 'markup-colors', title: 'Customize each markup color', location: 'Preferences → Special Markup Colors',
                    description: 'Choose individual colors for !!, ??, --, **, DONE, @mentions, and #tags. Each has a color picker and hex field. Highlights and document minimap markers follow those choices.',
                    keywords: ['special colors', 'urgent', 'question', 'important', 'deferred']
                },
                {
                    id: 'display-options', title: 'Wrap text, show numbers, and stripe rows', location: 'Header → Wrap; View → Line numbers and Zebra rows',
                    description: 'Wrap long text to the editor width. Line numbers support row selection and moving; zebra rows make adjacent lines easier to track. These display options belong to each document, so different tabs can use different settings.',
                    keywords: ['word wrap', 'line numbers', 'zebra', 'striping', 'per tab']
                },
                {
                    id: 'zoom', title: 'Adjust editor text size', location: 'View → Zoom in / Zoom out',
                    description: 'Zoom the editor text in or out with the menu or keyboard. Ctrl+0 restores the normal editor size. The compact header and bottom statistics keep their size while editor text changes.',
                    shortcuts: ['Ctrl++', 'Ctrl+-', 'Ctrl+0'], keywords: ['font size', 'larger text', 'smaller text', 'zoom reset']
                },
                {
                    id: 'tab-orientation', title: 'Put tabs at the top or side', location: 'Preferences → Tab Orientation',
                    description: 'Choose Top Tabs for a horizontal tab strip or Side Tabs for a document list beside the editor. Side tabs free the horizontal tab row for more visible text.',
                    keywords: ['sidebar', 'vertical tabs', 'horizontal tabs', 'screen height']
                },
                {
                    id: 'statistics', title: 'Read document statistics', location: 'Bottom status bar',
                    description: 'See total lines, words, characters, estimated reading time, and UTF-8 encoding. Outline mode also shows counts by outline level when list markers are present. Totals cover the full document, including hidden lines. The bar scrolls horizontally in narrow windows so every statistic remains available.',
                    keywords: ['stats', 'word count', 'character count', 'reading time', 'line count']
                },
                {
                    id: 'restore-defaults', title: 'Restore default preferences', location: 'Preferences → Restore Defaults',
                    description: 'Reset the theme, colors, tab orientation, editor zoom, and export/print preferences to their defaults. Your document text stays in place.',
                    keywords: ['reset settings', 'reset theme', 'defaults']
                }
            ]
        }
    ];

    function normalizeSearch(value) {
        return String(value ?? '').toLowerCase().replace(/\b(?:cmd|command|control)\b/g, 'ctrl').replaceAll('⌘', 'ctrl').replace(/\s*\+\s*/g, '+');
    }

    function findFeatures(query = '') {
        const normalized = normalizeSearch(query).trim();
        const terms = normalized.split(/\s+/).filter(Boolean);
        const isShortcut = /^(?:ctrl|shift|alt)\+\S+$/.test(normalized);
        return categories.map(category => ({
            ...category,
            features: category.features.filter(feature => {
                if (isShortcut) return (feature.shortcuts || []).some(shortcut => normalizeSearch(shortcut) === normalized);
                const text = normalizeSearch([feature.title, feature.location, feature.description,
                    feature.example || '', ...(feature.shortcuts || []), ...(feature.keywords || [])].join(' '));
                return normalizeSearch(category.title).includes(normalized) || terms.every(term => text.includes(term));
            })
        })).filter(category => category.features.length);
    }

    global.TabForgeFeatures = { categories, findFeatures, count: categories.reduce((total, category) => total + category.features.length, 0) };
})(window);

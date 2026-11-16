const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

test('immediate renders include queued updates', () => {
    const app = loadApp();
    app.run(`
        var renders = [];
        renderTabs = () => renders.push('tabs');
        renderEditorArea = () => renders.push('editor');
        updateToolbarUI = () => {};
        syncFindBarUi = () => {};
        requestRender('tabs');
        requestRender('editor', { immediate: true });
    `);
    assert.deepEqual(plain(app.renders), ['tabs', 'editor']);
    app.flushFrames();
    assert.deepEqual(plain(app.renders), ['tabs', 'editor']);
});

test('structural edits undo and redo with the original content and title', () => {
    const app = loadApp();
    app.run(`
        state.tabs = [createTabRecord({ id: 'a', content: 'original' })];
        state.activeTabId = 'a';
        renderTabs = renderEditorArea = updateToolbarUI = syncFindBarUi = () => {};
        updateTabLines('a', ['replaced', 'new line'], 1);
    `);
    assert.equal(app.run('canUndo()'), true);
    app.run('performUndo()');
    assert.equal(app.run('getActiveTab().content'), 'original');
    assert.equal(app.run('getActiveTab().title'), 'original.txt');
    app.run('performRedo()');
    assert.equal(app.run('getActiveTab().content'), 'replaced\nnew line');
    assert.equal(app.run('getActiveTab().title'), 'replaced.txt');
});

test('restoring a revision records one undo including collapsed state', () => {
    const app = loadApp();
    app.run(`
        state.tabs = [createTabRecord({ id: 'a', content: 'changed', manualSavedContent: 'saved', collapsedLines: [0] })];
        state.activeTabId = 'a';
        renderTabs = renderEditorArea = updateToolbarUI = syncFindBarUi = () => {};
        restoreLastManualSave('a');
    `);
    assert.equal(app.run('globalActionHistory.undo.length'), 1);
    app.run('performUndo()');
    assert.equal(app.run('getActiveTab().content'), 'changed');
    assert.deepEqual(plain(app.run('getActiveTab().collapsedLines')), [0]);
});

test('typing with an unchanged title and dirty state does not rebuild tabs', () => {
    const app = loadApp();
    app.run(`
        state.tabs = [createTabRecord({ id: 'a', title: 'fixed.txt', manuallyRenamed: true })];
        state.activeTabId = 'a';
        var tabRenders = 0;
        renderTabs = () => tabRenders++;
        updateToolbarUI = syncFindBarUi = () => {};
        updateContent('a', 'first', null, { coalesceTyping: true });
    `);
    app.flushFrames();
    app.run(`updateContent('a', 'second', null, { coalesceTyping: true })`);
    app.flushFrames();
    assert.equal(app.tabRenders, 1);
    assert.equal(app.run('globalActionHistory.undo.length'), 1);
});

test('search indexes are reused and highlights belong to the correct pane', () => {
    const app = loadApp();
    app.run(`
        state.tabs = [createTabRecord({id: 'a', content: 'hello'}), createTabRecord({id: 'b', content: 'xx hello'})];
        state.activeTabId = 'a'; state.search.query = 'hello';
        state.search.results = buildSearchResults(getActiveTab()); state.search.currentIndex = 0;
    `);
    assert.equal(app.run('getSearchResultsForLine(0) === getSearchResultsForLine(0)'), true);
    assert.equal(app.run(`renderInlineHighlights('xx hello', 0, 'b')`), 'xx <span class="search-hit">hello</span>');
    app.run(`getTabById('a').content = 'new hello'; state.search.results = buildSearchResults(getActiveTab())`);
    assert.equal(app.run('getSearchResultsForLine(0)[0].start'), 4);
});

test('document caches replace old versions and invalidate statistics on edits', () => {
    const app = loadApp();
    app.run(`
        var tab = createTabRecord({id: 'a', content: 'one two'});
        var originalStats = getTabStats(tab);
    `);
    assert.equal(app.run('getTabStats(tab) === originalStats'), true);
    app.run(`for (let i = 0; i < 500; i++) { tab.content = 'word ' + i; getTabStructure(tab); getTabStats(tab); getVisibleLineState(tab); }`);
    assert.equal(app.run('lineCache.size'), 1);
    assert.equal(app.run('structureCache.size'), 1);
    assert.equal(app.run('visibleStateCache.size'), 1);
    assert.equal(app.run('getTabStats(tab).words'), 2);
    assert.equal(app.run('getTabStats(tab) === originalStats'), false);
});

function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1));
    for (let i = 0; i <= a.length; i++) rows[i][0] = i;
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
    }
    return rows[a.length][b.length];
}

test('bounded fuzzy distance matches the reference algorithm', () => {
    const app = loadApp();
    const words = [''];
    for (let length = 1; length <= 5; length++) {
        for (let value = 0; value < 2 ** length; value++) words.push(value.toString(2).padStart(length, '0'));
    }
    for (const a of words) for (const b of words) for (const limit of [0, 1, 2, 5]) {
        assert.equal(app.levenshteinDistance(a, b, limit), Math.min(distance(a, b), limit + 1), `${a}/${b}/${limit}`);
    }
    assert.equal(app.levenshteinDistance('a'.repeat(20000), 'a'.repeat(19999) + 'b', 2), 1);
});

test('hydration repairs duplicate and selector-unsafe IDs and malformed settings', () => {
    const app = loadApp();
    const tabs = app.hydrateTabs([{ id: 'same', content: 'a' }, { id: 'same', content: 'b' }, { id: 'bad"]', content: 'c' }, null, []]);
    assert.equal(new Set(tabs.map(tab => tab.id)).size, 3);
    assert.ok(tabs.every(tab => /^[A-Za-z0-9_.-]+$/.test(tab.id)));
    const theme = app.run(`normalizePersistedThemePayload({ theme: { accent: 42, specialColors: { urgent: 'bad' }, mode: {} }, norm: { levels: [null,null,null,null,null,null,null] } })`);
    assert.equal(theme.theme.accent, '#2563eb');
    assert.equal(theme.theme.specialColors.urgent, '#E11900');
    assert.equal(theme.norm.levels[0], 'roman-dot');
    assert.equal(app.TabForgePersistence.hasUsableTabs({}), false);
    assert.equal(app.TabForgePersistence.hasUsableTabs([{}]), false);
});

test('storage commits recovery first, skips unchanged writes, and retries failures', () => {
    const { TabForgePersistence: persistence } = loadApp();
    const keys = persistence.getStorageKeys(56);
    const storage = new Map();
    const writes = [];
    let fail = null;
    const save = persistence.createStateWriter((key, value) => {
        writes.push(key);
        if (key === fail) return false;
        storage.set(key, value); return true;
    }, keys);
    const payload = { tabs: [{ id: 'a', content: 'old' }], activeTabId: 'a', themeData: {} };
    assert.equal(save(payload), true);
    assert.equal(writes[0], keys.recovery);
    writes.length = 0;
    assert.equal(save(payload), true);
    assert.equal(writes.length, 0);
    payload.tabs[0].content = 'new'; fail = keys.recovery;
    assert.equal(save(payload), false);
    assert.equal(JSON.parse(storage.get(keys.tabs))[0].content, 'old');
    assert.equal(JSON.parse(storage.get(keys.recovery)).tabs[0].content, 'old');
    fail = keys.tabs;
    assert.equal(save(payload), true);
    assert.equal(JSON.parse(storage.get(keys.recovery)).tabs[0].content, 'new');
    fail = null;
    assert.equal(save(payload), true);
    assert.equal(JSON.parse(storage.get(keys.tabs))[0].content, 'new');
    writes.length = 0; payload.activeTabId = 'b'; save(payload);
    assert.deepEqual(writes, [keys.recovery, keys.active]);
});

test('continuous editing flushes within two seconds and unchanged events do not save', () => {
    const app = loadApp();
    app.run(`
        var saves = 0;
        flushSaveToStorage = () => saves++;
        state.tabs = [createTabRecord({id: 'a', content: 'text'})]; state.activeTabId = 'a';
        updateContent('a', 'text');
    `);
    app.advanceTimers(1000);
    assert.equal(app.saves, 0);
    for (let index = 0; index < 5; index++) {
        app.saveToStorage(); app.advanceTimers(400);
    }
    assert.equal(app.saves, 1);
});

test('recovery wins after interrupted mirrors and legacy recovery survives invalid primary data', () => {
    for (const version of [undefined, 1]) {
        const app = loadApp();
        const recovery = { version, tabs: [{ id: 'recovered', content: 'complete snapshot' }], activeTabId: 'recovered', themeData: {} };
        app.savedValues = {
            tabforge_tabs_v56: version ? JSON.stringify([{ id: 'stale', content: 'stale mirror' }]) : '{}',
            tabforge_recovery_v56: JSON.stringify(recovery)
        };
        app.run(`
            safeStorageGet = key => savedValues[key] || null;
            cacheDomRefs = applyTheme = setupListeners = () => {};
            init();
        `);
        assert.equal(app.run('state.activeTabId'), 'recovered');
        assert.equal(app.run('getActiveTab().content'), 'complete snapshot');
    }
});

test('typing across tabs creates separate undo actions in chronological order', () => {
    const app = loadApp();
    app.run(`
        state.tabs = [createTabRecord({id:'a', content:''}), createTabRecord({id:'b', content:''})];
        renderTabs = renderEditorArea = updateToolbarUI = syncFindBarUi = () => {};
        state.activeTabId = 'a'; updateContent('a', 'a1', null, { coalesceTyping: true });
        state.activeTabId = 'b'; updateContent('b', 'b1', null, { coalesceTyping: true });
        state.activeTabId = 'a'; updateContent('a', 'a2', null, { coalesceTyping: true });
        performUndo();
    `);
    assert.equal(app.run('getTabById("a").content'), 'a1');
    assert.equal(app.run('getTabById("b").content'), 'b1');
    app.performUndo();
    assert.equal(app.run('getTabById("b").content'), '');
});

test('typing after undo starts a fresh undo group and clears redo', () => {
    const app = loadApp();
    app.run(`
        state.tabs = [createTabRecord({id:'a', content:''})]; state.activeTabId = 'a';
        renderTabs = renderEditorArea = updateToolbarUI = syncFindBarUi = () => {};
        updateContent('a', 'first');
        updateContent('a', 'second', null, { coalesceTyping: true });
        performUndo();
        updateContent('a', 'new edit', null, { coalesceTyping: true });
    `);
    assert.equal(app.run('canRedo()'), false);
    app.performUndo();
    assert.equal(app.run('getActiveTab().content'), 'first');
});

function lineApp(content, options = {}) {
    const app = loadApp();
    app.fixture = { id: 'a', content, ...options };
    app.run(`
        state.tabs = [createTabRecord(fixture)]; state.activeTabId = 'a';
        renderTabs = renderEditorArea = updateToolbarUI = syncFindBarUi = () => {};
    `);
    return app;
}

function inputEvent(overrides = {}) {
    return {
        button: 0, clientX: 10, clientY: 20, shiftKey: false,
        ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...overrides
    };
}

test('gutter selection focuses the line keyboard target and Shift arrows shrink and reverse from its anchor', () => {
    const app = lineApp('zero\none\ntwo\nthree\nfour');
    let focusCount = 0;
    app.document.querySelector = selector => selector.endsWith('.outline-root')
        ? { focus() { focusCount++; } } : null;
    const click = inputEvent();
    app.selectLineFromGutter(click, 'a', 2);
    app.endDragSelection();
    assert.equal(click.defaultPrevented, true);
    assert.equal(click.propagationStopped, true);
    assert.equal(focusCount, 1);
    for (const [key, indices] of [
        ['ArrowDown', [2, 3]], ['ArrowDown', [2, 3, 4]],
        ['ArrowDown', [2, 3, 4]], ['ArrowUp', [2, 3]], ['ArrowUp', [2]],
        ['ArrowUp', [1, 2]], ['ArrowUp', [0, 1, 2]], ['ArrowUp', [0, 1, 2]],
        ['ArrowDown', [1, 2]], ['ArrowDown', [2]], ['ArrowDown', [2, 3]]
    ]) {
        const event = inputEvent({ key, shiftKey: true });
        app.handleLineSelectionKeydown(event, 'a');
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(plain(app.getSelectedLineIndices('a')), indices);
        assert.equal(app.run('state.selectedLineAnchor.index'), 2);
    }
    assert.equal(app.run('state.activeLineIndex'), 3);
    assert.equal(focusCount, 12);
});

test('gutter Shift-click and modifier-click work while grabbing an already selected line preserves its range', () => {
    const app = lineApp('zero\none\ntwo\nthree\nfour');
    app.selectLineFromGutter(inputEvent(), 'a', 1);
    app.endDragSelection();
    app.selectLineFromGutter(inputEvent({ shiftKey: true }), 'a', 3);
    app.endDragSelection();
    app.selectLineFromGutter(inputEvent(), 'a', 2);
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [1, 2, 3]);
    assert.equal(app.run('state.selectedLineAnchor.index'), 1);
    assert.equal(app.run('state.activeLineIndex'), 3);
    assert.equal(app.run('state.pendingLineDrag.lineIndex'), 2);
    app.endDragSelection();
    app.selectLineFromGutter(inputEvent({ ctrlKey: true }), 'a', 2);
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [1, 3]);
    assert.equal(app.run('state.pendingLineDrag'), null);
    app.selectLineFromGutter(inputEvent({ metaKey: true }), 'a', 2);
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [1, 2, 3]);
    app.selectLineFromGutter(inputEvent({ button: 2 }), 'a', 4);
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [1, 2, 3]);
});

test('clicking the gutter of a line with a native caret still creates an explicit line selection', () => {
    const app = lineApp('zero\none\ntwo');
    app.run('isLineIndexSelected = () => true');
    app.selectLineFromGutter(inputEvent(), 'a', 1);
    assert.deepEqual(plain(app.run('state.selectedLineRange')), { tabId: 'a', start: 1, end: 1 });
});

test('Shift arrows navigate visible rows and include hidden lines in the whole-line range', () => {
    const app = lineApp('parent\n\tchild\n\t\tgrandchild\nnext', { collapsedLines: [0] });
    app.setSingleLineSelection('a', 0);
    app.handleLineSelectionKeydown(inputEvent({ key: 'ArrowDown', shiftKey: true }), 'a');
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [0, 1, 2, 3]);
    app.handleLineSelectionKeydown(inputEvent({ key: 'ArrowUp', shiftKey: true }), 'a');
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [0]);
    const modified = inputEvent({ key: 'ArrowDown', shiftKey: true, ctrlKey: true });
    app.handleLineSelectionKeydown(modified, 'a');
    assert.equal(modified.defaultPrevented, false);
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [0]);
});

test('dragging any selected parent expands the block through all descendants including collapsed ones', () => {
    const app = lineApp('first\n\tchild\n\t\tgrandchild !!\n\tother\nsecond\n\tlast\nend', { collapsedLines: [0, 1, 4] });
    app.setSingleLineSelection('a', 0);
    assert.deepEqual(plain(app.getDragMoveRange('a', 0)), { start: 0, end: 3 });
    app.setSelectedLineRange('a', 1, 4);
    assert.deepEqual(plain(app.getDragMoveRange('a', 2)), { start: 1, end: 5 });
    app.setSelectedLineRange('a', 0, 2);
    assert.deepEqual(plain(app.getDragMoveRange('a', 1)), { start: 0, end: 3 });
    app.setSelectedLineIndices('a', [0, 4]);
    assert.deepEqual(plain(app.getDragMoveRange('a', 4)), { start: 4, end: 5 });
});

test('drag threshold and the first move resolve the insertion target after a folded subtree', () => {
    const app = lineApp('source\nparent\n\tchild\n\t\tgrandchild\nend', { collapsedLines: [1] });
    app.selectLineFromGutter(inputEvent(), 'a', 0);
    app.handlePendingLineDrag(inputEvent({ clientX: 15, clientY: 25 }));
    assert.equal(app.run('state.dragMove'), null);
    const cell = { dataset: { editorTab: 'a' } };
    const row = {
        dataset: { rowIndex: '1' }, getBoundingClientRect: () => ({ top: 0, height: 24 }),
        closest: selector => selector === '.editor-cell' ? cell : row
    };
    app.document.elementFromPoint = () => row;
    app.handlePendingLineDrag(inputEvent({ clientX: 16, clientY: 25 }));
    assert.equal(app.run('state.pendingLineDrag'), null);
    assert.equal(app.run('state.dragMove.targetIndex'), 4);
    assert.equal(app.run('state.dragMove.position'), 'after');
    app.updateLineDragMoveTarget('a', 1, 'before');
    assert.equal(app.run('state.dragMove.targetIndex'), 1);
    app.finishLineDragMove();
    assert.equal(app.run('globalActionHistory.undo.length'), 0);
    assert.equal(app.run('getActiveTab().content'), 'source\nparent\n\tchild\n\t\tgrandchild\nend');
});

test('moving a folded block up or down preserves indentation, nested folds, selection and undo/redo', () => {
    for (const direction of ['up', 'down']) {
        const block = ['parent', '\tchild', '\t\tgrandchild', '\tother'];
        const before = direction === 'down' ? [...block, 'middle', 'end'] : ['middle', 'end', ...block];
        const after = direction === 'down' ? ['middle', 'end', ...block] : [...block, 'middle', 'end'];
        const start = direction === 'down' ? 0 : 2;
        const movedStart = direction === 'down' ? 2 : 0;
        const app = lineApp(before.join('\n'), { collapsedLines: [start, start + 1] });
        app.setSingleLineSelection('a', start);
        app.startLineDragMove('a', start);
        app.updateLineDragMoveTarget('a', direction === 'down' ? 5 : 0, direction === 'down' ? 'after' : 'before');
        app.finishLineDragMove();
        app.flushFrames();
        assert.equal(app.run('getActiveTab().content'), after.join('\n'));
        assert.deepEqual(plain(app.run('getActiveTab().collapsedLines')), [movedStart, movedStart + 1]);
        assert.deepEqual(plain(app.getSelectedLineIndices('a')), [movedStart, movedStart + 1, movedStart + 2, movedStart + 3]);
        assert.equal(app.run('globalActionHistory.undo.length'), 1);
        app.performUndo(); app.flushFrames();
        assert.equal(app.run('getActiveTab().content'), before.join('\n'));
        assert.deepEqual(plain(app.run('getActiveTab().collapsedLines')), [start, start + 1]);
        assert.deepEqual(plain(app.getSelectedLineIndices('a')), [start]);
        assert.equal(app.run('state.selectedLineAnchor.index'), start);
        app.performRedo(); app.flushFrames();
        assert.equal(app.run('getActiveTab().content'), after.join('\n'));
        assert.deepEqual(plain(app.run('getActiveTab().collapsedLines')), [movedStart, movedStart + 1]);
        assert.deepEqual(plain(app.getSelectedLineIndices('a')), [movedStart, movedStart + 1, movedStart + 2, movedStart + 3]);
    }
});

test('no-op drops, Escape and drops outside the source pane leave content and undo history untouched', () => {
    const app = lineApp('zero\none\ntwo\nthree');
    app.setSelectedLineRange('a', 1, 2);
    for (const [index, position] of [[1, 'before'], [1, 'after'], [2, 'after']]) {
        app.startLineDragMove('a', 1);
        app.updateLineDragMoveTarget('a', index, position);
        app.finishLineDragMove();
    }
    app.startLineDragMove('a', 1);
    app.updateLineDragMoveTarget('a', 0, 'before');
    app.handleLineSelectionKeydown(inputEvent({ key: 'Escape' }), 'a');
    assert.equal(app.run('state.dragMove'), null);
    app.startLineDragMove('a', 1);
    app.updateLineDragMoveTarget('a', 0, 'before');
    app.handlePendingLineDrag(inputEvent());
    assert.equal(app.run('state.dragMove.targetIndex'), null);
    app.finishLineDragMove();
    assert.equal(app.run('getActiveTab().content'), 'zero\none\ntwo\nthree');
    assert.equal(app.run('globalActionHistory.undo.length'), 0);
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [1, 2]);
});

test('folding hides even one attention-marked child and retains nested fold state through undo/redo', () => {
    const app = lineApp('single\n\tonly child !!\nparent\n\tnested\n\t\tgrandchild ??\nend');
    const visible = () => plain(app.run('getVisibleLineState(getActiveTab()).visible.map(node => node.index)'));
    app.toggleLineFold('a', 0);
    assert.deepEqual(visible(), [0, 2, 3, 4, 5]);
    app.toggleLineFold('a', 3);
    app.toggleLineFold('a', 2);
    assert.deepEqual(visible(), [0, 2, 5]);
    app.toggleLineFold('a', 2);
    assert.deepEqual(visible(), [0, 2, 3, 5]);
    assert.deepEqual(plain(app.run('getActiveTab().collapsedLines')), [0, 3]);
    app.performUndo();
    assert.deepEqual(visible(), [0, 2, 5]);
    app.performRedo();
    assert.deepEqual(visible(), [0, 2, 3, 5]);
    const undoCount = app.run('globalActionHistory.undo.length');
    app.toggleLineFold('a', 5);
    assert.equal(app.run('globalActionHistory.undo.length'), undoCount);
});

test('line-selection shortcuts leave other controls and already handled editing events alone', () => {
    const app = lineApp('zero\none\ntwo');
    app.setSelectedLineRange('a', 0, 1);
    const otherInput = { closest: selector => selector.includes('input') ? {} : null };
    for (const handler of ['handleSelectedRangeDelete', 'handleSelectedRangeTab', 'handleSelectedRangeCopy', 'handleSelectedRangeCut', 'handleSelectedRangePaste']) {
        const event = inputEvent({ key: handler.endsWith('Tab') ? 'Tab' : 'Delete', target: otherInput });
        app[handler](event);
        assert.equal(event.defaultPrevented, false);
    }
    const handled = inputEvent({ key: 'Delete', defaultPrevented: true });
    app.handleSelectedRangeDelete(handled);
    assert.equal(app.run('getActiveTab().content'), 'zero\none\ntwo');
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [0, 1]);
});

test('immediate undo cancels stale editing focus so the restored line selection survives', () => {
    const app = lineApp('zero\none\ntwo');
    app.run(`
        getLineEditor = () => ({
            focus() { clearSelectedLineSelection(); },
            scrollIntoView() {}, textContent: ''
        });
        placeCaret = () => {};
        setSingleLineSelection('a', 1);
        deleteSelectedRangeLines();
        performUndo();
    `);
    app.flushFrames();
    assert.equal(app.run('getActiveTab().content'), 'zero\none\ntwo');
    assert.deepEqual(plain(app.getSelectedLineIndices('a')), [1]);
});

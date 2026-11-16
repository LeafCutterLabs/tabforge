const path = require('node:path');
module.exports = async (page, { outputDir }) => {
    const results = [];
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const equal = (value, expected, message) => assert(JSON.stringify(value) === JSON.stringify(expected), `${message}: ${JSON.stringify(value)}`);
    const row = index => page.locator(`.outline-row[data-tab-id="gutter-qa"][data-row-index="${index}"]`);
    const number = index => row(index).locator('.line-number-label');
    const fold = index => row(index).locator('.line-fold-toggle');
    const selected = () => page.evaluate(() => getSelectedLineIndices('gutter-qa'));
    const visible = () => page.locator('.outline-row[data-tab-id="gutter-qa"]').evaluateAll(rows => rows.map(row => Number(row.dataset.rowIndex)));
    const content = () => page.evaluate(() => getTabById('gutter-qa').content);
    const seed = async (lines, options = {}) => {
        await page.evaluate(({ lines, options }) => {
            state.tabs = [createTabRecord({ id: 'gutter-qa', title: 'Gutter QA.txt', manuallyRenamed: true, content: lines.join('\n'), ...options })];
            state.activeTabId = 'gutter-qa'; state.activeLineIndex = 0; state.multiViewIds = [];
            state.dragMove = state.pendingLineDrag = state.dragSelecting = state.pendingCaret = null;
            clearSelectedLineSelection();
            for (const key of Object.keys(historyByTab)) delete historyByTab[key];
            globalActionHistory.undo.length = globalActionHistory.redo.length = 0;
            state.search.open = false; state.search.query = ''; state.search.results = [];
            state.theme.mode = 'default'; state.theme.accent = '#2563eb';
            invalidateTabCaches('gutter-qa'); applyTheme(); render();
        }, { lines, options });
    };
    const drag = async (sourceIndex, targetIndex, position = 'after') => {
        const source = await number(sourceIndex).boundingBox();
        const target = await row(targetIndex).boundingBox();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + (position === 'before' ? 2 : target.height - 2));
    };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.reload();
    await page.evaluate(() => { window.__gutterQaOriginalState = structuredClone(state); });
    try {
        await seed(['zero', 'one', 'two', 'three', 'four']);
        await number(2).click();
        for (const [key, expected] of [
            ['Shift+ArrowDown', [2, 3]], ['Shift+ArrowDown', [2, 3, 4]],
            ['Shift+ArrowUp', [2, 3]], ['Shift+ArrowUp', [2]], ['Shift+ArrowUp', [1, 2]],
            ['Shift+ArrowDown', [2]], ['Shift+ArrowDown', [2, 3]]
        ]) {
            await page.keyboard.press(key);
            equal(await selected(), expected, 'keyboard range');
            equal(await page.evaluate(() => state.selectedLineAnchor.index), 2, 'stable anchor');
            assert(await page.evaluate(() => document.activeElement.classList.contains('outline-root')), 'root must retain keyboard focus');
        }
        await number(2).click(); equal(await selected(), [2, 3], 'selected click retains range');
        await number(3).click({ modifiers: ['Control'] }); equal(await selected(), [2], 'Ctrl toggle');
        await number(0).click({ modifiers: ['Meta'] }); equal(await selected(), [0, 2], 'Meta toggle');
        await row(1).locator('.outline-line').click();
        await number(1).click(); equal(await selected(), [1], 'gutter after editing same line');
        await number(3).click({ modifiers: ['Shift'] }); equal(await selected(), [1, 2, 3], 'Shift-click anchor');
        results.push('click focus, keyboard extension/shrink/reversal, selected grab, Ctrl/Meta/Shift-click');

        for (const mode of ['default', 'dark', 'matrix']) {
            await seed(['plain', 'attention !!', 'unselected', 'other']);
            await page.evaluate(mode => { state.theme.mode = mode; state.theme.accent = '#ffffff'; applyTheme(); render(); }, mode);
            await number(0).click(); await number(1).click({ modifiers: ['Shift'] });
            const styles = await page.locator('.row-selected').evaluateAll(rows => rows.map(row => ({
                bg: getComputedStyle(row).backgroundColor, color: getComputedStyle(row.querySelector('.outline-line')).color,
                stripe: row.classList.contains('zebra-row-alt'), border: getComputedStyle(row, '::after').borderLeftWidth
            })));
            equal(styles[0].bg, styles[1].bg, `${mode}: selected zebra equality`);
            assert(styles.every(style => style.border === '4px' && style.color !== style.bg), `${mode}: readable selected text and border`);
            await page.screenshot({ path: path.join(outputDir, `gutter-selection-${mode}.png`) });
        }
        results.push('solid selection takes priority over zebra/attention in default, dark and matrix themes, including white accent');

        await seed(['single parent', '\tchild !!', 'parent', '\tnested', '\t\tgrandchild ??', 'end']);
        await fold(0).click(); equal(await visible(), [0, 2, 3, 4, 5], 'one-child fold');
        equal(await fold(0).getAttribute('aria-expanded'), 'false', 'collapsed accessibility state');
        equal(await selected(), [], 'fold does not select');
        assert(await page.evaluate(() => !state.pendingLineDrag && !state.dragMove && !state.dragSelecting), 'fold must not initiate drag');
        await page.keyboard.press('Space'); equal(await visible(), [0, 1, 2, 3, 4, 5], 'keyboard fold reopens with focus retained');
        await fold(3).click(); await fold(2).click(); await fold(2).click();
        equal(await visible(), [0, 1, 2, 3, 5], 'nested fold retained');
        equal(await row(5).locator('button').count(), 0, 'leaf has no folding button');
        await page.evaluate(() => { getActiveTab().showLineNumbers = false; render(); });
        equal(await page.locator('.line-number-label').count(), 0, 'numbers off');
        assert(await fold(0).isVisible(), 'fold arrow remains usable with numbers off');
        await fold(0).click(); equal(await visible(), [0, 2, 3, 5], 'fold with numbers off');
        results.push('single-child and attention folds, nested state, leaf controls, keyboard activation, numbers off');

        const original = ['source', '\tchild', '\t\tgrandchild !!', 'destination', '\thidden child', 'last'];
        await seed(original, { collapsedLines: [0, 1, 3] });
        const grab = await number(0).boundingBox();
        await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
        await page.mouse.down(); await page.mouse.move(grab.x + grab.width / 2 + 3, grab.y + grab.height / 2 + 3); await page.mouse.up();
        equal(await content(), original.join('\n'), 'sub-threshold click');
        equal(await page.evaluate(() => globalActionHistory.undo.length), 0, 'sub-threshold history');
        await drag(0, 3, 'after');
        equal(await page.evaluate(() => ({ start: state.dragMove.start, end: state.dragMove.end, target: state.dragMove.targetIndex })), { start: 0, end: 2, target: 5 }, 'full source subtree and folded destination');
        equal(await row(3).evaluate(row => getComputedStyle(row, '::before').height), '3px', 'insertion marker');
        await page.screenshot({ path: path.join(outputDir, 'gutter-drag-marker.png') });
        await page.mouse.up();
        const moved = ['destination', '\thidden child', 'source', '\tchild', '\t\tgrandchild !!', 'last'].join('\n');
        equal(await content(), moved, 'drop order and indentation');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [0, 2, 3], 'fold state moved with rows');
        equal(await selected(), [2, 3, 4], 'moved range remains selected');
        await page.keyboard.press('Control+z');
        equal(await content(), original.join('\n'), 'undo content');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [0, 1, 3], 'undo fold state');
        equal(await selected(), [0], 'undo selection');
        await page.keyboard.press('Control+Shift+z'); equal(await content(), moved, 'redo content');
        equal(await selected(), [2, 3, 4], 'redo selection');
        await page.keyboard.press('Enter');
        assert(await page.evaluate(() => document.activeElement.dataset.tabLine === 'gutter-qa:2'), 'Enter edits visible folded parent');
        results.push('threshold, parent including hidden descendants, marker, folded destination, selected drop, undo/redo and Enter editing');

        await seed(['zero', 'one', 'two', 'three']);
        await number(1).click(); await number(2).click({ modifiers: ['Shift'] });
        await drag(1, 3, 'after'); await page.mouse.up();
        equal(await content(), 'zero\nthree\none\ntwo', 'grab moves selected contiguous block');
        equal(await selected(), [2, 3], 'contiguous block selection follows move');
        await drag(2, 0, 'before'); await page.keyboard.press('Escape'); await page.mouse.up();
        equal(await content(), 'zero\nthree\none\ntwo', 'Escape cancels');
        await drag(2, 0, 'before'); await page.mouse.move(10, 10); await page.mouse.up();
        equal(await content(), 'zero\nthree\none\ntwo', 'outside drop cancels');
        results.push('selected multi-line drag, Escape cancellation and outside cancellation');

        await seed(['zero', 'one', 'two']);
        await number(1).click(); await page.keyboard.press('Control+f');
        await page.locator('#find-input').fill('find text');
        await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
        equal(await content(), 'zero\none\ntwo', 'find input does not delete selected rows');
        await page.keyboard.press('Escape');
        await row(0).locator('.outline-line').click(); await page.keyboard.type('X');
        equal(await page.locator('.row-selected').count(), 0, 'editing clears whole-row highlight');
        assert((await content()).includes('X'), 'normal text editing');
        await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => document.activeElement.dataset.tabLine === 'gutter-qa:1', null, { timeout: 5000 });
        assert(await page.evaluate(() => document.activeElement.dataset.tabLine === 'gutter-qa:1'), 'normal arrow navigation');
        await page.keyboard.press('Shift+ArrowDown'); equal(await selected(), [1, 2], 'text-to-whole-line keyboard selection');
        results.push('find input isolation, ordinary text editing, arrow navigation, Shift-arrow from editing');

        await seed(['zero', 'one', 'two']);
        await number(1).click();
        await page.evaluate(() => {
            const data = new DataTransfer();
            const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
            document.activeElement.dispatchEvent(event);
            window.__gutterQaCopied = data.getData('text/plain');
        });
        equal(await page.evaluate(() => window.__gutterQaCopied), 'one', 'copy selected row');
        await page.keyboard.press('Delete'); equal(await content(), 'zero\ntwo', 'Delete whole selected row');
        await page.keyboard.press('Control+z'); equal(await content(), 'zero\none\ntwo', 'Delete undo');
        await page.keyboard.press('Tab'); equal(await content(), 'zero\n\tone\ntwo', 'Tab indent selected row');
        results.push('whole-line copy/Delete/Tab and undo shortcuts');

        await seed(['I. Parent', '\tA. Child', '\t\ti. Grandchild', 'II. End'], { outlineModeActive: true });
        await fold(0).click(); equal(await visible(), [0, 3], 'outline-mode fold');
        await page.keyboard.press('Control+z'); equal(await visible(), [0, 1, 2, 3], 'fold undo');
        await page.keyboard.press('Control+y'); equal(await visible(), [0, 3], 'fold redo');
        await drag(0, 3, 'after'); await page.mouse.up();
        equal(await content(), 'II. End\nI. Parent\n\tA. Child\n\t\ti. Grandchild', 'outline move keeps text and indentation');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [1], 'outline fold follows moved parent');
        results.push('outline-mode subtree moves and folding undo/redo');

        const foldedFixture = ['intro', 'parent', '\tchild', '\t\tgrandchild', 'last'];
        await seed(foldedFixture, { collapsedLines: [1, 2] });
        await number(0).click(); await page.keyboard.press('Delete');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [0, 1], 'Delete remaps nested folds');
        equal(await visible(), [0, 3], 'parent stays folded after deleting above it');
        equal(await row(0).locator('.fold-summary').textContent(), '2 hidden lines', 'hidden-line count');
        await page.screenshot({ path: path.join(outputDir, 'fold-summary.png') });
        assert((await fold(0).getAttribute('aria-label')).includes('2 hidden lines'), 'hidden count is accessible');
        await page.keyboard.press('Control+z');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [1, 2], 'fold locations restored by undo');
        await row(0).locator('.outline-line').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [2, 3], 'Enter shifts following folds');
        equal(await visible(), [0, 1, 2, 5], 'Enter keeps following descendants hidden');
        await seed(foldedFixture, { collapsedLines: [1, 2] });
        await row(1).locator('.outline-line').click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [2, 3], 'Enter at start carries the parent fold with its text');
        await seed(foldedFixture, { collapsedLines: [1, 2] });
        await row(1).locator('.outline-line').click(); await page.keyboard.press('Home'); await page.keyboard.press('Backspace');
        equal(await content(), 'introparent\n\tchild\n\t\tgrandchild\nlast', 'Backspace merge');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [0, 1], 'Backspace carries merged fold');
        await seed(foldedFixture, { collapsedLines: [1, 2] });
        await row(0).locator('.outline-line').click(); await page.keyboard.press('End'); await page.keyboard.press('Delete');
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [0, 1], 'Delete merge carries folded parent');
        await seed(foldedFixture, { collapsedLines: [1, 2] });
        await row(0).locator('.outline-line').click(); await page.keyboard.press('Home');
        await row(0).locator('.outline-line').evaluate(line => {
            const data = new DataTransfer(); data.setData('text/plain', 'before\n');
            line.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        equal(await page.evaluate(() => getActiveTab().collapsedLines), [2, 3], 'multiline paste shifts folds');
        equal(await visible(), [0, 1, 2, 5], 'pasted lines preserve collapsed descendants');
        results.push('insert/delete, split, both merge keys and multiline paste preserve nested folds; hidden counts and undo');

        await seed(Array.from({ length: 5000 }, (_, index) => `line ${index}`));
        await page.evaluate(() => {
            window.__qaEditor = document.querySelector('.outline-root');
            window.__qaFirstLine = getLineEditor('gutter-qa', 0);
            window.__qaLastLine = getLineEditor('gutter-qa', 4999);
        });
        await number(0).click(); await number(4999).click({ modifiers: ['Shift'] });
        equal((await selected()).length, 5000, 'large selection');
        await page.keyboard.press('Shift+ArrowUp'); equal((await selected()).length, 4999, 'large selection shrink');
        await number(0).scrollIntoViewIfNeeded();
        await drag(0, 1, 'after');
        assert(await page.evaluate(() => window.__qaEditor === document.querySelector('.outline-root')
            && window.__qaFirstLine === getLineEditor('gutter-qa', 0)
            && window.__qaLastLine === getLineEditor('gutter-qa', 4999)), 'selection and dragging preserve existing row nodes');
        await page.keyboard.press('Escape'); await page.mouse.up();
        equal((await selected()).length, 4999, 'large cancelled drag keeps selection');
        results.push('5,000-row range selection, shrink and drag marker reuse the existing DOM');

        for (const fontSize of [10, 26]) {
            await seed(['long parent '.repeat(60), '\tchild', 'end'], { showWordWrap: true });
            await page.evaluate(fontSize => { state.theme.editorFontSize = fontSize; applyTheme(); render(); }, fontSize);
            const arrow = await fold(0).boundingBox();
            const label = await number(0).boundingBox();
            assert(Math.abs(arrow.y + arrow.height / 2 - label.y - label.height / 2) < 1, 'arrow stays beside number on a wrapped row at each zoom');
            await number(0).click(); await page.keyboard.press('Shift+ArrowDown');
            equal(await selected(), [0, 1], 'wrapped keyboard selection');
            await fold(0).click(); equal(await visible(), [0, 2], 'wrapped fold');
            if (fontSize === 26) await page.screenshot({ path: path.join(outputDir, 'wrapped-fold-summary.png') });
        }
        results.push('wrapped rows and minimum/maximum font sizes');

        await seed(['zero', 'one']);
        await page.evaluate(() => {
            state.tabs.push(createTabRecord({ id: 'other-qa', title: 'Other QA.txt', content: 'other\n\tchild' }));
            state.multiViewIds = ['gutter-qa', 'other-qa']; render();
        });
        await number(1).click();
        const source = await number(1).boundingBox();
        const other = await page.locator('.outline-row[data-tab-id="other-qa"]').first().boundingBox();
        await page.mouse.move(source.x + 5, source.y + 5); await page.mouse.down();
        await page.mouse.move(other.x + other.width / 2, other.y + 5); await page.mouse.up();
        equal(await content(), 'zero\none', 'cross-pane drag cancels');
        equal(await page.evaluate(() => getTabById('other-qa').content), 'other\n\tchild', 'other pane untouched');
        results.push('multi-view pane isolation');
        equal(errors, [], 'browser errors');
        return { passed: results, browserErrors: errors };
    } catch (error) {
        await page.screenshot({ path: path.join(outputDir, 'failure.png') });
        throw error;
    } finally {
        await page.mouse.up();
        await page.evaluate(() => {
            state = window.__gutterQaOriginalState;
            delete window.__gutterQaOriginalState;
            for (const key of Object.keys(historyByTab)) delete historyByTab[key];
            globalActionHistory.undo.length = globalActionHistory.redo.length = 0;
            state.dragMove = state.pendingLineDrag = state.dragSelecting = null;
            applyTheme(); render(); flushSaveToStorage();
        });
    }
}

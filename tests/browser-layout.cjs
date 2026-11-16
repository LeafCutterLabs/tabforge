const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (page, { outputDir }) => {
    const metrics = () => page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        return {
            header: rect('#app-header').height, footer: rect('footer').height,
            footerBottom: rect('footer').bottom, editor: rect('#editor-container').height,
            toolbarInHeader: Boolean(document.querySelector('#app-header #toolbar-buttons')),
            workspaceChildren: [...document.querySelector('#editor-workspace').children].map(node => node.id)
        };
    });
    const openView = () => page.locator('.app-menu > summary').filter({ hasText: /^View/ }).click();
    const gains = {};
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.evaluate(() => {
        window.__compactOriginal = structuredClone(state);
        state.tabs = [createTabRecord({ id: 'compact', title: 'Project notes.txt', manuallyRenamed: true,
            content: ['I. Project plan', '\tA. Requirements', '\tB. Draft', 'II. DONE Research', 'III. Next steps',
                ...Array.from({ length: 45 }, (_, index) => `Note ${index + 1}`)].join('\n') })];
        state.activeTabId = 'compact'; state.activeLineIndex = 0; state.multiViewIds = [];
        state.theme.editorFontSize = 14; state.search.open = false; state.search.query = '';
        clearSelectedLineSelection(); applyTheme(); render();
    });
    try {
        for (const mode of ['default', 'dark', 'matrix']) {
            for (const orientation of ['horizontal', 'vertical']) {
                await page.evaluate(({ mode, orientation }) => {
                    state.theme.mode = mode; state.theme.orientation = orientation; applyTheme(); render();
                }, { mode, orientation });
                const layout = await metrics();
                assert.equal(layout.header, 44, `${mode}/${orientation}: header stays one row`);
                assert.equal(layout.footer, 24, 'statistics bar stays compact');
                assert.equal(layout.footerBottom, 900, 'statistics stay at the bottom');
                assert.equal(layout.toolbarInHeader, true);
                assert.deepEqual(layout.workspaceChildren, ['editor-container'], 'no separate toolbar row');
                // Measured on the preceding layout at the same viewport and normal zoom.
                gains[orientation] = layout.editor - (orientation === 'horizontal' ? 682 : 734);
                assert.equal(gains[orientation], 98, 'recover roughly 100 pixels without changing text size');
                assert.equal(await page.locator('.status-bar #stat-lines').innerText(), '50');
                await page.screenshot({ path: path.join(outputDir, `compact-${mode}-${orientation}.png`) });
            }
        }

        await page.evaluate(() => { state.theme.mode = 'default'; applyTheme(); render(); });
        await page.locator('#toggle-word-wrap').click();
        await page.waitForFunction(() => document.getElementById('toggle-word-wrap').getAttribute('aria-pressed') === 'true');
        assert.equal(await page.locator('#toggle-word-wrap').getAttribute('aria-pressed'), 'true');
        await page.locator('#toggle-outline-mode').click();
        await page.waitForFunction(() => getActiveTab().outlineModeActive);
        await openView();
        await page.locator('#outline-level-filter-btn').click();
        await page.waitForFunction(() => getActiveTab().outlineLevelFilter === 1);
        await openView(); await page.locator('#toggle-hide-completed').click();
        await page.waitForFunction(() => document.getElementById('toggle-hide-completed').getAttribute('aria-pressed') === 'true');
        assert.equal(await page.locator('#toggle-hide-completed').getAttribute('aria-pressed'), 'true');

        await page.evaluate(() => {
            state.tabs.push(createTabRecord({ id: 'compact-other', title: 'Other notes.txt', content: 'Other document' }));
            state.multiViewIds = ['compact', 'compact-other']; state.multiViewMode = 'vert'; render();
        });
        await openView(); await page.locator('#toggle-view-mode').click();
        await page.waitForFunction(() => state.multiViewMode === 'horiz');
        await page.evaluate(() => {
            state.multiViewIds = []; getActiveTab().outlineLevelFilter = null; getActiveTab().hideCompletedLines = false;
            updateContent('compact', 'edited notes'); render();
        });
        await page.locator('#manual-save-btn').click();
        assert.equal(await page.evaluate(() => getActiveTab().manualSavedContent), 'edited notes');
        await page.locator('#undo-btn').click();
        await page.waitForFunction(() => getActiveTab().content !== 'edited notes');
        await page.locator('#redo-btn').click();
        await page.waitForFunction(() => getActiveTab().content === 'edited notes');

        for (const width of [900, 760, 600, 520, 375, 320]) {
            await page.setViewportSize({ width, height: 700 });
            const layout = await metrics();
            assert.equal(layout.header, 44, `${width}px: controls never wrap into another row`);
            assert.equal(layout.footerBottom, 700, `${width}px: bottom statistics remain visible`);
            const overflowing = await page.locator('#app-header button:visible, #app-header summary:visible').evaluateAll(elements => elements
                .filter(element => { const rect = element.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth; })
                .map(element => element.id || element.textContent));
            assert.deepEqual(overflowing, [], `${width}px: header controls fit`);
            await openView();
            const menuRect = await page.locator('.app-menu[open] .menu-popover').boundingBox();
            assert.ok(menuRect.x >= 0 && menuRect.x + menuRect.width <= width, `${width}px: View menu fits`);
            if (width <= 600) {
                const proxy = page.locator('[data-proxy="toggle-word-wrap"]');
                const previous = await proxy.getAttribute('aria-pressed');
                await proxy.click();
                await page.waitForFunction(previous => document.querySelector('[data-proxy="toggle-word-wrap"]').getAttribute('aria-pressed') !== previous, previous);
                assert.notEqual(await proxy.getAttribute('aria-pressed'), previous, 'narrow-menu toggle stays synchronized');
            } else {
                await page.keyboard.press('Escape');
            }
            for (const id of ['stat-lines', 'stat-words', 'stat-chars', 'stat-time']) {
                const stat = page.locator('#' + id);
                await stat.scrollIntoViewIfNeeded();
                const box = await stat.boundingBox();
                assert.ok(box && box.height > 0 && box.y >= 676 && box.y + box.height <= 700, `${width}px: ${id} stays in the footer`);
            }
            await page.locator('#open-find-btn').click();
            await page.locator('#find-input').focus();
            assert.equal((await metrics()).editor, layout.editor, 'Find opens over the editor without taking another row');
            await page.keyboard.press('Escape');
        }
        await page.locator('#open-settings-btn').click();
        await page.locator('#close-settings-btn').click();
        await page.waitForFunction(() => document.getElementById('settings-menu').getBoundingClientRect().left >= innerWidth - 1);
        await page.screenshot({ path: path.join(outputDir, 'compact-narrow.png') });
        assert.deepEqual(errors, []);
        return { recoveredPixels: gains, defaultSizeAdditionalRows: 4, viewportsChecked: [1280, 900, 760, 600, 520, 375, 320], browserErrors: errors };
    } catch (error) {
        await page.screenshot({ path: path.join(outputDir, 'compact-failure.png') });
        throw error;
    } finally {
        await page.evaluate(() => { state = window.__compactOriginal; delete window.__compactOriginal; applyTheme(); render(); });
    }
};

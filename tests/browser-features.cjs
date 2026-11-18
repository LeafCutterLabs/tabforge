const assert = require('node:assert/strict');
const path = require('node:path');
const { version } = require('../package.json');

module.exports = async (page, { outputDir }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.evaluate(() => {
        window.__featuresOriginal = structuredClone(state);
        state.tabs = [createTabRecord({ id: 'features-check', title: 'Feature checks.txt', content: 'one two three four' })];
        state.activeTabId = 'features-check'; state.multiViewIds = []; state.search.open = false;
        clearSelectedLineSelection(); render();
    });
    try {
        const line = page.locator('[data-tab-line="features-check:0"]');
        await line.click();
        await line.dblclick({ position: { x: 25, y: 12 } });
        assert.equal(await page.evaluate(() => getSelection().toString().trimEnd()), 'one', 'first double-click selects a word');
        await line.dblclick({ position: { x: 25, y: 12 } });
        assert.equal(await page.evaluate(() => getSelection().toString().trimEnd()), 'one two', 'repeated double-click adds the next word');
        await line.dblclick({ position: { x: 25, y: 12 } });
        assert.equal(await page.evaluate(() => getSelection().toString().trimEnd()), 'one two three', 'the documented gesture keeps growing');

        await page.locator('#open-settings-btn').click();
        await page.waitForFunction(() => document.activeElement.id === 'settings-preferences-tab');
        await page.waitForFunction(() => Math.abs(document.getElementById('settings-menu').getBoundingClientRect().right - innerWidth) < 1);
        assert.equal(await page.locator('#settings-preferences-panel').isVisible(), true);
        assert.equal(await page.locator('#settings-features-panel').isVisible(), false);
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#settings-features-tab').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#settings-preferences-panel').isVisible(), false);
        assert.equal(await page.locator('#feature-version').innerText(), `Version ${version}`);
        const count = await page.evaluate(() => TabForgeFeatures.count);
        assert.equal(await page.locator('.feature-entry').count(), count);
        assert.equal(await page.locator('.feature-category').count(), 6);
        assert.equal(await page.locator('#feature-list details[open]').count(), 0, 'the outline starts folded for scanning');
        const contentMatches = await page.evaluate(() => TabForgeFeatures.categories.every(category => {
            const section = document.querySelector(`[data-category-id="${category.id}"]`);
            if (section.querySelector(':scope > summary .feature-outline-label').textContent !== category.title) return false;
            return category.features.every(feature => {
                const entry = section.querySelector(`[data-feature-id="${feature.id}"]`);
                return entry.querySelector(':scope > summary .feature-outline-label').textContent === feature.title
                    && entry.querySelector('.feature-location').textContent === feature.location
                    && entry.querySelector('.feature-description').textContent === feature.description
                    && (entry.querySelector('.feature-example')?.textContent || '') === (feature.example || '')
                    && JSON.stringify([...entry.querySelectorAll('kbd')].map(key => key.textContent)) === JSON.stringify(feature.shortcuts || []);
            });
        }));
        assert.equal(contentMatches, true, 'every category, title, description, location, example and shortcut is retained verbatim');
        await page.screenshot({ path: path.join(outputDir, 'features-folded.png') });
        const category = page.locator('[data-category-id="selection"]');
        const firstFeature = page.locator('[data-feature-id="grow-word-selection"]');
        await category.locator(':scope > summary').click();
        assert.equal(await firstFeature.locator(':scope > summary').isVisible(), true, 'opening a category reveals its feature rows');
        assert.equal(await firstFeature.locator('.feature-description').isVisible(), false, 'instructions remain folded independently');
        await firstFeature.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await firstFeature.locator('.feature-description').isVisible(), true, 'Enter opens the focused outline item');
        await page.keyboard.press('Space');
        assert.equal(await firstFeature.locator('.feature-description').isVisible(), false, 'Space closes the focused outline item');
        await page.keyboard.press('Space');
        await category.locator(':scope > summary').click();
        assert.equal(await firstFeature.locator('.feature-description').isVisible(), false);
        await category.locator(':scope > summary').click();
        assert.equal(await firstFeature.locator('.feature-description').isVisible(), true, 'child folds survive closing and reopening their parent');
        await page.screenshot({ path: path.join(outputDir, 'features-default.png') });

        const search = page.locator('#feature-search');
        await page.keyboard.press('Control+f');
        assert.equal(await search.evaluate(element => element === document.activeElement), true);
        assert.equal(await page.evaluate(() => state.search.open), false, 'guide search does not open document Find');
        await search.fill('double click');
        assert.equal(await page.locator('.feature-entry').count(), 1);
        assert.equal(await page.locator('.feature-entry').getAttribute('data-feature-id'), 'grow-word-selection');
        assert.equal(await page.locator('.feature-description').isVisible(), true, 'matched instructions open automatically');
        await search.fill('Cmd+S');
        assert.equal(await page.locator('.feature-entry').count(), 1);
        assert.equal(await page.locator('.feature-entry').getAttribute('data-feature-id'), 'save-revision');
        await search.fill('no_such_feature');
        assert.equal(await page.locator('.feature-entry').count(), 0);
        assert.equal(await page.locator('.feature-empty').isVisible(), true);
        assert.equal(await page.locator('#feature-expand-all').isDisabled(), true);
        await page.locator('#feature-clear').click();
        assert.equal(await page.locator('.feature-entry').count(), count);
        assert.equal(await firstFeature.locator('.feature-description').isVisible(), true, 'clearing search restores the previous folds');
        assert.equal(await page.locator('[data-category-id="outline"]').getAttribute('open'), null, 'search does not unfold unrelated categories permanently');
        await page.locator('#feature-expand-all').click();
        assert.equal(await page.locator('#feature-list details[open]').count(), count + 6, 'Expand all opens both outline levels');
        await page.locator('#feature-collapse-all').click();
        assert.equal(await page.locator('#feature-list details[open]').count(), 0, 'Collapse all closes both outline levels');

        await page.evaluate(() => updateContent('features-check', 'keep this edit'));
        const undoCount = await page.evaluate(() => globalActionHistory.undo.length);
        await search.pressSequentially('outline');
        await search.press('Control+z');
        assert.equal(await page.evaluate(() => getActiveTab().content), 'keep this edit', 'editing guide search cannot undo the document');
        assert.equal(await page.evaluate(() => globalActionHistory.undo.length), undoCount);
        await search.fill('');
        await page.locator('#close-settings-btn').focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.closest('#settings-menu') !== null), true, 'focus wraps within settings');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'close-settings-btn');
        await page.locator('#feature-expand-all').click();

        for (const mode of ['default', 'dark', 'matrix']) {
            await page.evaluate(mode => { state.theme.mode = mode; applyTheme(); render(); }, mode);
            for (const width of [1280, 375, 320]) {
                await page.setViewportSize({ width, height: 800 });
                await page.locator('#feature-list').evaluate(list => { list.scrollTop = list.scrollHeight; });
                const bounds = await page.locator('#feature-version').boundingBox();
                assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'version stays on screen');
                assert.equal(await page.locator('#settings-features-tab').isVisible(), true, 'tabs stay reachable while scrolling');
                assert.equal(await page.locator('#settings-menu').evaluate(menu => menu.scrollWidth <= menu.clientWidth), true, 'guide does not overflow horizontally');
                assert.equal(await page.locator('#feature-list').evaluate(list => list.scrollWidth <= list.clientWidth), true, 'nested outline content wraps inside the guide');
                if (width === 375) {
                    await search.fill('moving lines');
                    await page.screenshot({ path: path.join(outputDir, `features-${mode}-narrow.png`) });
                    await search.fill('');
                }
            }
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('#settings-features-tab').focus();
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.locator('#settings-preferences-tab').getAttribute('aria-selected'), 'true');
        await page.locator('#settings-preferences-panel').evaluate(panel => { panel.scrollTop = 0; });
        await page.locator('.mode-btn[data-mode="default"]').click();
        assert.equal(await page.evaluate(() => state.theme.mode), 'default', 'existing preferences still work');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#settings-menu').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.locator('#settings-menu').evaluate(menu => menu.inert), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'open-settings-btn');
        await page.locator('#open-settings-btn').click();
        await page.waitForFunction(() => document.activeElement.id === 'settings-preferences-tab');
        await page.keyboard.press('Control+f');
        assert.equal(await page.locator('#settings-features-tab').getAttribute('aria-selected'), 'true', 'Ctrl+F also reaches the guide from Preferences');
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        return { version, documentedFeatures: count, verbatimContent: 'passed', nestedOutlineAndBulkFolding: 'passed', wordSelectionGesture: 'passed', tabKeyboardAndSearch: 'passed', themesAndNarrowWidths: 'passed', browserErrors: errors };
    } catch (error) {
        await page.screenshot({ path: path.join(outputDir, 'features-failure.png') });
        throw error;
    } finally {
        await page.evaluate(() => { state = window.__featuresOriginal; delete window.__featuresOriginal; applyTheme(); render(); });
    }
};

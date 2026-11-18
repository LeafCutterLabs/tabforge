const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function catalog() {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'feature-catalog.js'), 'utf8'), context);
    return context.window.TabForgeFeatures;
}
const ids = (features, query) => Array.from(features.findFeatures(query), group => Array.from(group.features, feature => feature.id)).flat();

test('feature inventory has unique identifiers and actionable descriptions', () => {
    const features = catalog();
    const entries = Array.from(features.categories, group => Array.from(group.features)).flat();
    assert.equal(features.count, entries.length);
    assert.equal(new Set(entries.map(feature => feature.id)).size, entries.length);
    assert.ok(entries.length >= 30);
    assert.ok(entries.every(feature => feature.title && feature.description && feature.location));
    assert.ok(ids(features, '').includes('grow-word-selection'));
    assert.ok(ids(features, '').includes('move-lines'));
    assert.ok(ids(features, '').includes('magic-outline'));
});

test('feature search matches gestures, all query words and category names', () => {
    const features = catalog();
    assert.ok(ids(features, 'DOUBLE CLICK').includes('grow-word-selection'));
    assert.deepEqual(ids(features, 'hidden children drag'), ['move-lines']);
    assert.ok(ids(features, 'outlines').includes('fold-branches'));
    assert.equal(ids(features, 'no_such_feature').length, 0);
    assert.equal(ids(features, '   ').length, features.count);
});

test('shortcut search treats Ctrl, Cmd and Command alike without matching other keys', () => {
    const features = catalog();
    for (const query of ['Ctrl+S', 'Cmd+S', 'Command + S', '⌘+S']) {
        assert.deepEqual(ids(features, query), ['save-revision']);
    }
    assert.deepEqual(ids(features, 'Ctrl++'), ['zoom']);
    assert.deepEqual(ids(features, 'Ctrl+Shift+Z'), ['undo-redo']);
});

test('displayed release metadata uses the package version', () => {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/release.js'), 'utf8'), context);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(context.window.TabForgeRelease.version, pkg.version);
});

const { performance } = require('node:perf_hooks');
const { loadApp } = require('../tests/helpers.cjs');
const app = loadApp(process.argv[2]);
app.run(String.raw`
    state.tabs = [createTabRecord({ id: 'bench', content: Array.from({length: 2000}, (_, i) => '1. Searchable line ' + i).join('\n') })];
    state.activeTabId = 'bench'; state.search.query = 'line';
    state.search.results = buildSearchResults(getActiveTab());
`);
function measure(name, operation) {
    operation();
    const samples = [];
    for (let i = 0; i < 5; i++) {
        const start = performance.now(); operation(); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(`${name}: ${samples[2].toFixed(2)} ms (median of 5)`);
}
measure('2,000 line search lookups', () => app.run('for (let i = 0; i < 2000; i++) getSearchResultsForLine(i)'));
measure('100 repeated outline statistics reads', () => app.run('for (let i = 0; i < 100; i++) getOutlineLevelCounts(getActiveTab())'));

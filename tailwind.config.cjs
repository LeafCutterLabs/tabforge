module.exports = {
    content: ['./index.html', './app.js'],
    // Multi-view builds these class names from the number of visible tabs.
    safelist: ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-rows-1', 'grid-rows-2', 'grid-rows-3', 'grid-rows-4'],
    theme: { extend: {} },
    plugins: []
};

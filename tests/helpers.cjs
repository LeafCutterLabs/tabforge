const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp(appPath = path.join(__dirname, '..', 'app.js')) {
    const callbacks = new Map();
    const timers = new Map();
    let now = 0;
    let nextId = 0;
    const context = vm.createContext({
        console, Map, Set, WeakMap,
        document: { addEventListener() {}, querySelector() { return null; } },
        requestAnimationFrame(callback) { callbacks.set(++nextId, callback); return nextId; },
        cancelAnimationFrame(id) { callbacks.delete(id); },
        setTimeout(callback, delay) { timers.set(++nextId, { callback, at: now + delay }); return nextId; },
        clearTimeout(id) { timers.delete(id); },
    });
    context.window = context;
    for (const file of ['tab-model.js', 'persistence.js', 'commands.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: 'app.js' });
    context.run = code => vm.runInContext(code, context);
    context.flushFrames = () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach(callback => callback());
    };
    context.advanceTimers = milliseconds => {
        const end = now + milliseconds;
        while (true) {
            const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback();
        }
        now = end;
    };
    return context;
}
module.exports = { loadApp };

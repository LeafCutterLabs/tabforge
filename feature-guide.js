(function (global) {
    let initialized = false;
    const expanded = new Set();

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function branch(className, key, query, marker, title) {
        const item = node('details', className);
        item.dataset.outlineKey = key;
        item.open = Boolean(query) || expanded.has(key);
        const summary = node('summary', 'feature-outline-row');
        const number = node('span', 'feature-outline-marker', marker);
        number.setAttribute('aria-hidden', 'true');
        summary.append(number, node('span', 'feature-outline-label', title));
        item.appendChild(summary);
        item.addEventListener('toggle', () => {
            if (query || !item.isConnected) return;
            if (item.open) expanded.add(key);
            else expanded.delete(key);
        });
        return item;
    }

    function renderFeatures() {
        const search = document.getElementById('feature-search');
        const list = document.getElementById('feature-list');
        const query = search.value.trim();
        const groups = global.TabForgeFeatures.findFeatures(query);
        const count = groups.reduce((total, group) => total + group.features.length, 0);
        const sections = groups.map(group => {
            const categoryIndex = global.TabForgeFeatures.categories.findIndex(category => category.id === group.id);
            const category = global.TabForgeFeatures.categories[categoryIndex];
            const marker = ['I.', 'II.', 'III.', 'IV.', 'V.', 'VI.'][categoryIndex] || `${categoryIndex + 1}.`;
            const section = branch('feature-category', `category:${group.id}`, query, marker, group.title);
            section.dataset.categoryId = group.id;
            section.firstElementChild.appendChild(node('span', 'feature-outline-count', `${group.features.length} ${group.features.length === 1 ? 'feature' : 'features'}`));
            const children = node('div', 'feature-children');
            for (const feature of group.features) {
                const featureIndex = category.features.findIndex(entry => entry.id === feature.id);
                const item = branch('feature-entry', `feature:${feature.id}`, query, `${String.fromCharCode(65 + featureIndex)}.`, feature.title);
                item.dataset.featureId = feature.id;
                const body = node('div', 'feature-body');
                body.appendChild(node('p', 'feature-location', feature.location));
                body.appendChild(node('p', 'feature-description', feature.description));
                if (feature.example) body.appendChild(node('pre', 'feature-example', feature.example));
                if (feature.shortcuts?.length) {
                    const shortcuts = node('div', 'feature-shortcuts');
                    shortcuts.setAttribute('aria-label', 'Shortcuts and gestures');
                    feature.shortcuts.forEach(shortcut => shortcuts.appendChild(node('kbd', '', shortcut)));
                    body.appendChild(shortcuts);
                }
                item.appendChild(body);
                children.appendChild(item);
            }
            section.appendChild(children);
            return section;
        });
        if (!count) sections.push(node('p', 'feature-empty', 'No matching features. Try a word such as “move”, “outline”, “save”, or a shortcut.'));
        list.replaceChildren(...sections);
        list.scrollTop = 0;
        document.getElementById('feature-results').textContent = query
            ? `${count} of ${global.TabForgeFeatures.count} features`
            : `${count} features across ${groups.length} sections`;
        document.getElementById('feature-clear').hidden = !query;
        document.getElementById('feature-expand-all').disabled = !count;
        document.getElementById('feature-collapse-all').disabled = !count;
    }

    function initialize({ onClose }) {
        if (initialized) return;
        const menu = document.getElementById('settings-menu');
        const tabs = [...menu.querySelectorAll('[role="tab"]')];
        if (!tabs.length || !global.TabForgeFeatures) return;
        initialized = true;
        let catalogRendered = false;
        const selectTab = selected => {
            tabs.forEach(tab => {
                const active = tab === selected;
                tab.setAttribute('aria-selected', String(active));
                tab.tabIndex = active ? 0 : -1;
                document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
            });
            if (selected.id === 'settings-features-tab' && !catalogRendered) {
                renderFeatures();
                catalogRendered = true;
            }
        };
        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => selectTab(tab));
            tab.addEventListener('keydown', event => {
                let next;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                selectTab(tabs[next]);
                tabs[next].focus();
            });
        });
        document.getElementById('feature-version').textContent = global.TabForgeRelease?.version
            ? `Version ${global.TabForgeRelease.version}` : 'Development version';
        const search = document.getElementById('feature-search');
        search.addEventListener('input', renderFeatures);
        search.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
        });
        document.getElementById('feature-clear').addEventListener('click', () => {
            search.value = '';
            renderFeatures();
            search.focus();
        });
        for (const [id, open] of [['feature-expand-all', true], ['feature-collapse-all', false]]) {
            document.getElementById(id).addEventListener('click', () => {
                const list = document.getElementById('feature-list');
                list.querySelectorAll('details').forEach(item => {
                    item.open = open;
                    if (!search.value.trim()) {
                        if (open) expanded.add(item.dataset.outlineKey);
                        else expanded.delete(item.dataset.outlineKey);
                    }
                });
                list.scrollTop = 0;
            });
        }
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                event.stopPropagation();
                selectTab(document.getElementById('settings-features-tab'));
                search.focus();
                search.select();
            } else if (event.key === 'Tab') {
                const focusable = [...menu.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')]
                    .filter(element => !element.disabled && element.tabIndex >= 0 && element.checkVisibility());
                const target = event.shiftKey ? focusable[focusable.length - 1] : focusable[0];
                if (document.activeElement === (event.shiftKey ? focusable[0] : focusable[focusable.length - 1])) {
                    event.preventDefault();
                    target?.focus();
                }
            }
        });
    }

    global.TabForgeFeatureGuide = { initialize };
})(window);

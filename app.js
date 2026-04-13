        const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX", "XXXI", "XXXII", "XXXIII", "XXXIV", "XXXV", "XXXVI", "XXXVII", "XXXVIII", "XXXIX", "XL", "XLI", "XLII", "XLIII", "XLIV", "XLV", "XLVI", "XLVII", "XLVIII", "XLIX", "L"];
        const DEFAULT_OUTLINE_LEVELS = ['roman-dot', 'alpha-upper-dot', 'number-dot', 'alpha-dot', 'roman-lower-dot', 'alpha-paren', 'roman-lower-paren'];
        const BULLET_LEVELS = ['-', '+', '*'];
        const OUTLINE_STYLE_LABELS = {
            'roman-dot': 'I.',
            'alpha-upper-dot': 'A.',
            'number-dot': '1.',
            'alpha-dot': 'a.',
            'roman-lower-dot': 'i.',
            'alpha-paren': '(a)',
            'roman-lower-paren': '(i)',
            'alpha-upper-paren': '(A)',
            'roman-paren': '(I)'
        };
        const OUTLINE_LABEL_TO_STYLE = Object.fromEntries(Object.entries(OUTLINE_STYLE_LABELS).map(([key, value]) => [value.toLowerCase(), key]));

        let state = {
            tabs: [],
            activeTabId: '',
            multiViewIds: [],
            multiViewMode: 'vert',
            lastTabTime: 0,
            tempOutlineDisabled: false,
            activeLineIndex: 0,
            selectedLineRange: null,
            dragSelecting: null,
            dragMove: null,
            pendingLineDrag: null,
            pendingCaret: null,
            preserveSelectionOnFocus: false,
            hoveredLineKey: null,
            search: { open: false, query: '', fuzzy: false, results: [], currentIndex: -1 },
            theme: { accent: '#2563eb', mode: 'default', orientation: 'horizontal', zipExport: false },
            norm: { separator: '.', levels: [...DEFAULT_OUTLINE_LEVELS] }
        };

        let draggedTabId = null;
        const historyByTab = {};
        const lineCache = new Map();
        const visibleStateCache = new Map();
        const searchResultsCache = new Map();
        let suppressHistory = false;
        let saveTimer = null;
        let renderFrame = null;
        let pendingRender = { layout: false, tabs: false, editor: false, toolbar: false, find: false };
        const TAB_RENAME_HOVER_MS = 800;
        const SAVE_DEBOUNCE_MS = 120;

        const STORAGE_KEY_TABS = 'tabforge_tabs_v54';
        const STORAGE_KEY_ACTIVE = 'tabforge_active_v54';
        const STORAGE_KEY_THEME = 'tabforge_theme_v54';

        function expandRenderFlags(flags = 'full') {
            if (flags === 'full') return { layout: true, tabs: true, editor: true, toolbar: true, find: true };
            if (flags === 'editor') return { layout: false, tabs: false, editor: true, toolbar: true, find: true };
            if (flags === 'tabs') return { layout: false, tabs: true, editor: false, toolbar: true, find: false };
            if (flags === 'toolbar') return { layout: false, tabs: false, editor: false, toolbar: true, find: true };
            if (flags === 'find') return { layout: false, tabs: false, editor: false, toolbar: false, find: true };
            return { layout: false, tabs: false, editor: false, toolbar: false, find: false, ...(flags || {}) };
        }

        function mergeRenderFlags(target, source) {
            Object.keys(target).forEach(key => {
                target[key] = target[key] || Boolean(source[key]);
            });
        }

        function applyLayoutClasses() {
            const body = document.getElementById('app-body');
            const tabs = document.getElementById('tabs-container');
            if (!body || !tabs) return;
            if (state.theme.orientation === 'vertical') {
                body.className = "flex flex-1 overflow-hidden flex-row tabs-vertical";
                tabs.className = "flex flex-col w-[150px] shrink-0 overflow-y-auto no-scrollbar pt-2 border-r border-black/10";
            } else {
                body.className = "flex flex-1 overflow-hidden flex-col tabs-horizontal";
                tabs.className = "flex items-end h-9 px-2 pt-1 overflow-x-auto no-scrollbar shrink-0";
            }
        }

        function flushRender(flags = pendingRender) {
            if (renderFrame) {
                cancelAnimationFrame(renderFrame);
                renderFrame = null;
            }
            const nextFlags = { ...flags };
            pendingRender = { layout: false, tabs: false, editor: false, toolbar: false, find: false };
            if (nextFlags.layout) applyLayoutClasses();
            if (nextFlags.editor || nextFlags.tabs || nextFlags.toolbar || nextFlags.find) {
                refreshSearchResults({ preserveIndex: true });
            }
            if (nextFlags.tabs) renderTabs();
            if (nextFlags.editor) renderEditorArea();
            if (nextFlags.toolbar) updateToolbarUI();
            if (nextFlags.find) syncFindBarUi();
        }

        function requestRender(flags = 'full', options = {}) {
            const expanded = expandRenderFlags(flags);
            if (options.immediate) {
                flushRender(expanded);
                return;
            }
            mergeRenderFlags(pendingRender, expanded);
            if (renderFrame) return;
            renderFrame = requestAnimationFrame(() => {
                renderFrame = null;
                flushRender();
            });
        }

        function mutateState(mutator, options = {}) {
            const { render = null, save = false, immediate = false } = options;
            mutator();
            if (save) saveToStorage();
            if (render) requestRender(render, { immediate });
        }

        function createDefaultTab() {
            const content = '1. Welcome to tabForge\n3. Export single or all tabs\n2. Reorder your workspace\n\nCheck stats in the footer!';
            return {
                id: '1',
                title: 'tabForge.txt',
                content,
                manuallyRenamed: false,
                showLineNumbers: true,
                showZebra: true,
                outlineModeActive: false,
                collapsedLines: [],
                manualSavedContent: content,
                manualSavedAt: Date.now()
            };
        }

        function getTabById(id) {
            return state.tabs.find(tab => tab.id === id);
        }

        function getActiveTab() {
            return getTabById(state.activeTabId);
        }

        function ensureTxtExtension(title) {
            if (!title) return 'untitled.txt';
            return title.toLowerCase().endsWith('.txt') ? title : title + '.txt';
        }

        function appendNewToTitle(title) {
            const base = title.replace(/\.txt$/i, '');
            return ensureTxtExtension(base + ' NEW');
        }

        function deriveTitleFromText(text) {
            const first = (text || '').trim().replace(/^[#\-\[\]x!!\d\.\s\)]+/, '').substring(0, 30);
            return ensureTxtExtension(first || 'untitled');
        }

        function lockTabTitleFromFirstLine(tab, lineText) {
            if (!tab || tab.manuallyRenamed) return;
            tab.title = deriveTitleFromText(lineText);
            tab.manuallyRenamed = true;
            requestRender('tabs');
        }

        function duplicateActiveTab() {
            const source = getActiveTab();
            if (!source) return;
            const id = Date.now().toString() + Math.random();
            const copy = {
                id,
                title: appendNewToTitle(source.title),
                content: source.content,
                manuallyRenamed: true,
                showLineNumbers: source.showLineNumbers,
                showZebra: source.showZebra,
                outlineModeActive: source.outlineModeActive,
                collapsedLines: [...(source.collapsedLines || [])],
                manualSavedContent: source.content,
                manualSavedAt: Date.now()
            };
            const sourceIndex = state.tabs.findIndex(tab => tab.id === source.id);
            state.tabs.splice(sourceIndex + 1, 0, copy);
            state.activeTabId = id;
            saveToStorage();
            requestRender('full');
        }

        function getOutlineLevels() {
            return Array.isArray(state.norm.levels) && state.norm.levels.length ? state.norm.levels : [...DEFAULT_OUTLINE_LEVELS];
        }

        function getOutlineStyleLabel(style) {
            return OUTLINE_STYLE_LABELS[style] || '1.';
        }

        function normalizeOutlineStyleInput(value, fallback) {
            const normalized = value.trim().toLowerCase();
            return OUTLINE_LABEL_TO_STYLE[normalized] || fallback;
        }

        function getEditorTextarea(tabId = state.activeTabId) {
            return document.querySelector(`textarea[data-tab-id="${tabId}"]`);
        }

        function getLineEditor(tabId = state.activeTabId, lineIndex = state.activeLineIndex) {
            return document.querySelector(`[data-tab-line="${tabId}:${lineIndex}"]`);
        }

        function placeCaret(el, offset = 0) {
            if (!el) return;
            const selection = window.getSelection();
            const range = document.createRange();
            const textNode = el.firstChild || el;
            const safeOffset = Math.min(offset, el.textContent.length);
            range.setStart(textNode, safeOffset);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        function getCaretOffset(el) {
            const selection = window.getSelection();
            if (!selection.rangeCount || !el.contains(selection.anchorNode)) return 0;
            const range = selection.getRangeAt(0).cloneRange();
            range.selectNodeContents(el);
            range.setEnd(selection.anchorNode, selection.anchorOffset);
            return range.toString().length;
        }

        function getLineElementFromNode(node) {
            let current = node;
            while (current) {
                if (current.nodeType === Node.ELEMENT_NODE && current.dataset && current.dataset.lineIndex !== undefined) {
                    return current;
                }
                current = current.parentNode;
            }
            return null;
        }

        function getSelectedLineRange(tabId) {
            if (state.selectedLineRange && state.selectedLineRange.tabId === tabId) {
                return {
                    start: state.selectedLineRange.start,
                    end: state.selectedLineRange.end,
                    isMultiLine: state.selectedLineRange.start !== state.selectedLineRange.end,
                    hasSelection: true
                };
            }

            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return null;

            const anchorLine = getLineElementFromNode(selection.anchorNode);
            const focusLine = getLineElementFromNode(selection.focusNode);
            if (!anchorLine || !focusLine) return null;
            if (!anchorLine.dataset.tabLine.startsWith(`${tabId}:`) || !focusLine.dataset.tabLine.startsWith(`${tabId}:`)) return null;

            const start = Number(anchorLine.dataset.lineIndex);
            const end = Number(focusLine.dataset.lineIndex);
            if (!Number.isInteger(start) || !Number.isInteger(end)) return null;

            return {
                start: Math.min(start, end),
                end: Math.max(start, end),
                isMultiLine: start !== end,
                hasSelection: !selection.isCollapsed
            };
        }

        function focusEditorAtStart(tabId = state.activeTabId) {
            requestAnimationFrame(() => {
                const line = getLineEditor(tabId, 0);
                if (line) {
                    state.activeLineIndex = 0;
                    line.focus({ preventScroll: true });
                    placeCaret(line, 0);
                    return;
                }
                const ta = getEditorTextarea(tabId);
                if (!ta) return;
                ta.focus({ preventScroll: true });
                ta.selectionStart = 0;
                ta.selectionEnd = 0;
                ta.scrollTop = 0;
                ta.scrollLeft = 0;
            });
        }

        function startInlineRenameTab(id, labelEl) {
            const tab = getTabById(id);
            if (!tab || !labelEl) return;
            if (labelEl.parentElement.querySelector('input')) return;

            const input = document.createElement('input');
            input.type = 'text';
            input.value = tab.title.replace(/\.txt$/i, '');
            input.className = 'w-full bg-white/90 text-slate-900 border border-[var(--accent-color)] rounded px-1 text-xs outline-none';

            let finished = false;
            const finish = (commit) => {
                if (finished) return;
                finished = true;

                if (commit) {
                    const trimmed = input.value.trim();
                    tab.title = ensureTxtExtension(trimmed || 'untitled');
                    tab.manuallyRenamed = true;
                    saveToStorage();
                    requestRender({ tabs: true, toolbar: true, find: false, editor: false, layout: false });
                    return;
                }

                labelEl.textContent = tab.title;
                labelEl.classList.remove('hidden');
                input.remove();
            };

            labelEl.classList.add('hidden');
            labelEl.parentElement.insertBefore(input, labelEl);
            input.focus();
            input.select();

            input.onblur = () => finish(true);
            input.onkeydown = (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finish(true);
                if (e.key === 'Escape') finish(false);
            };
        }

        function getTabLines(tab) {
            if (!tab) return [''];
            return getCachedLines(tab.content || '', tab.id || 'tab');
        }

        function getLineDepth(rawLine) {
            const info = getSymbolInfo(rawLine);
            if (info) return info.indent;
            const match = rawLine.match(/^\t+/);
            return match ? match[0].length : 0;
        }

        function getDisplayText(rawLine) {
            return rawLine.replace(/^\t+/, '');
        }

        function getLineTextLength(lines, index) {
            if (index < 0 || index >= lines.length) return 0;
            return getDisplayText(lines[index]).length;
        }

        function escapeHtml(value) {
            return value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getSearchResultsForLine(lineIndex) {
            if (!state.search.query || !state.search.results.length) return [];
            return state.search.results
                .map((result, index) => ({ ...result, resultIndex: index }))
                .filter(result => result.lineIndex === lineIndex);
        }

        function collectTokenRanges(text) {
            return Array.from(text.matchAll(/[@#][A-Za-z0-9_.-]+/g)).map(match => ({
                start: match.index,
                end: match.index + match[0].length,
                className: match[0].startsWith('@') ? 'token-mention' : 'token-tag'
            }));
        }

        function renderInlineHighlights(text, lineIndex) {
            const tokenRanges = collectTokenRanges(text);
            const searchRanges = getSearchResultsForLine(lineIndex);
            const boundaries = new Set([0, text.length]);

            tokenRanges.forEach(range => {
                boundaries.add(range.start);
                boundaries.add(range.end);
            });
            searchRanges.forEach(range => {
                boundaries.add(range.start);
                boundaries.add(range.end);
            });

            const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
            let html = '';

            for (let i = 0; i < sortedBoundaries.length - 1; i++) {
                const start = sortedBoundaries[i];
                const end = sortedBoundaries[i + 1];
                if (start === end) continue;
                const segmentText = escapeHtml(text.slice(start, end));
                const classes = [];
                const tokenRange = tokenRanges.find(range => start >= range.start && end <= range.end);
                const searchRange = searchRanges.find(range => start >= range.start && end <= range.end);
                if (tokenRange) classes.push(tokenRange.className);
                if (searchRange) {
                    classes.push('search-hit');
                    if (searchRange.resultIndex === state.search.currentIndex) classes.push('search-hit-current');
                }
                html += classes.length ? `<span class="${classes.join(' ')}">${segmentText}</span>` : segmentText;
            }

            return html;
        }

        function setLineDisplayContent(lineEl, text, isEditing = false, lineIndex = null) {
            lineEl.classList.toggle('empty', !text);
            if (isEditing) {
                lineEl.textContent = text;
                return;
            }
            lineEl.innerHTML = renderInlineHighlights(text, lineIndex);
        }

        function getIndentGuidePositions(depth) {
            if (depth < 1) return [];
            return Array.from({ length: depth }, (_, index) => 12 + index * 20);
        }

        function applyIndentGuides(lineEl, depth) {
            const positions = getIndentGuidePositions(depth);
            if (!positions.length) {
                lineEl.classList.remove('has-guides');
                lineEl.style.backgroundImage = '';
                lineEl.style.backgroundSize = '';
                lineEl.style.backgroundPosition = '';
                return;
            }

            lineEl.classList.add('has-guides');
            lineEl.style.backgroundImage = positions.map(() => 'linear-gradient(to bottom, rgba(148, 163, 184, 0.28), rgba(148, 163, 184, 0.28))').join(',');
            lineEl.style.backgroundSize = positions.map(() => '1px 100%').join(',');
            lineEl.style.backgroundPosition = positions.map(position => `${position}px 0`).join(',');
        }

        function getAttentionType(rawLine) {
            if (rawLine.includes('!!')) return 'urgent';
            if (rawLine.includes('??')) return 'question';
            return null;
        }

        function getSubtreeEndIndex(lines, startIndex) {
            const startDepth = getLineDepth(lines[startIndex]);
            let end = startIndex;
            for (let i = startIndex + 1; i < lines.length; i++) {
                if (getLineDepth(lines[i]) <= startDepth) break;
                end = i;
            }
            return end;
        }

        function getDescendantCount(lines, startIndex) {
            return getSubtreeEndIndex(lines, startIndex) - startIndex;
        }

        function getCollapsedLineSet(tab) {
            return new Set(tab.collapsedLines || []);
        }

        function getVisibleStateCacheKey(tab) {
            return [
                tab?.id || '',
                tab?.content || '',
                JSON.stringify(tab?.collapsedLines || [])
            ].join('::');
        }

        function getSearchCacheKey(tab, query = state.search.query, fuzzy = state.search.fuzzy) {
            return [
                tab?.id || '',
                tab?.content || '',
                query.trim().toLowerCase(),
                fuzzy ? '1' : '0'
            ].join('::');
        }

        function invalidateTabCaches(tabId) {
            for (const key of lineCache.keys()) {
                if (key.startsWith(`${tabId}::`)) lineCache.delete(key);
            }
            for (const key of visibleStateCache.keys()) {
                if (key.startsWith(`${tabId}::`)) visibleStateCache.delete(key);
            }
            for (const key of searchResultsCache.keys()) {
                if (key.startsWith(`${tabId}::`)) searchResultsCache.delete(key);
            }
        }

        function invalidateSearchCache() {
            searchResultsCache.clear();
        }

        function getCachedLines(content = '', cacheKey = 'global') {
            const key = `${cacheKey}::${content}`;
            if (lineCache.has(key)) return lineCache.get(key);
            const lines = String(content).split('\n');
            lineCache.set(key, lines);
            return lines;
        }

        function getManualSavedContent(tab) {
            if (!tab) return '';
            return typeof tab.manualSavedContent === 'string' ? tab.manualSavedContent : tab.content;
        }

        function getManualSavedLines(tab) {
            return getCachedLines(getManualSavedContent(tab), `${tab?.id || 'tab'}:manual`);
        }

        function isTabDirty(tab) {
            return Boolean(tab) && tab.content !== getManualSavedContent(tab);
        }

        function areAnyTabsDirty() {
            return state.tabs.some(tab => isTabDirty(tab));
        }

        function formatManualSaveTime(timestamp) {
            if (!timestamp) return 'Never';
            return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function getSearchableText(rawLine) {
            return getDisplayText(rawLine);
        }

        function levenshteinDistance(a, b) {
            const rows = a.length + 1;
            const cols = b.length + 1;
            const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
            for (let i = 0; i < rows; i++) dp[i][0] = i;
            for (let j = 0; j < cols; j++) dp[0][j] = j;
            for (let i = 1; i < rows; i++) {
                for (let j = 1; j < cols; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,
                        dp[i][j - 1] + 1,
                        dp[i - 1][j - 1] + cost
                    );
                }
            }
            return dp[a.length][b.length];
        }

        function getFuzzyMatches(text, query) {
            if (query.trim().length < 3) return [];
            const matches = [];
            const tokenRegex = /[A-Za-z0-9_.-]+/g;
            const normalizedQuery = query.toLowerCase();
            const allowedDistance = normalizedQuery.length <= 4 ? 1 : 2;
            let match;

            while ((match = tokenRegex.exec(text)) !== null) {
                const token = match[0];
                if (Math.abs(token.length - normalizedQuery.length) > allowedDistance) continue;
                if (levenshteinDistance(token.toLowerCase(), normalizedQuery) <= allowedDistance) {
                    matches.push({ start: match.index, end: match.index + token.length });
                }
            }

            return matches;
        }

        function buildSearchResults(tab) {
            if (!tab || !state.search.query.trim()) return [];
            const cacheKey = getSearchCacheKey(tab);
            if (searchResultsCache.has(cacheKey)) return searchResultsCache.get(cacheKey);
            const query = state.search.query.trim();
            const normalizedQuery = query.toLowerCase();
            const lines = getTabLines(tab);
            const results = [];

            lines.forEach((rawLine, lineIndex) => {
                const text = getSearchableText(rawLine);
                if (!text) return;

                if (state.search.fuzzy && query.length >= 3) {
                    getFuzzyMatches(text, query).forEach(match => {
                        results.push({ lineIndex, start: match.start, end: match.end });
                    });
                    return;
                }

                const lower = text.toLowerCase();
                let fromIndex = 0;
                while (fromIndex < lower.length) {
                    const foundIndex = lower.indexOf(normalizedQuery, fromIndex);
                    if (foundIndex === -1) break;
                    results.push({ lineIndex, start: foundIndex, end: foundIndex + query.length });
                    fromIndex = foundIndex + Math.max(1, query.length);
                }
            });

            searchResultsCache.set(cacheKey, results);
            return results;
        }

        function countMatchesInOtherTabs() {
            const activeTabId = state.activeTabId;
            return state.tabs
                .filter(tab => tab.id !== activeTabId)
                .reduce((total, tab) => total + buildSearchResults(tab).length, 0);
        }

        function syncFindBarUi() {
            const findBar = document.getElementById('find-bar');
            const input = document.getElementById('find-input');
            const fuzzy = document.getElementById('find-fuzzy-toggle');
            const count = document.getElementById('find-count');
            const otherTabs = document.getElementById('find-other-tabs');
            if (!findBar || !input || !fuzzy || !count || !otherTabs) return;
            findBar.classList.toggle('hidden', !state.search.open);
            findBar.classList.toggle('flex', state.search.open);
            input.value = state.search.query;
            fuzzy.checked = state.search.fuzzy;
            fuzzy.disabled = state.search.query.trim().length < 3;
            fuzzy.parentElement.style.opacity = fuzzy.disabled ? '0.5' : '1';
            if (!state.search.query.trim()) {
                count.textContent = '0 matches';
                otherTabs.textContent = '0:other';
                return;
            }
            const current = state.search.results.length ? `${state.search.currentIndex + 1}/${state.search.results.length}` : '0';
            count.textContent = `${current} matches`;
            const otherMatchCount = countMatchesInOtherTabs();
            otherTabs.textContent = `${otherMatchCount}:other`;
        }

        function refreshSearchResults({ preserveIndex = false } = {}) {
            const tab = getActiveTab();
            const previous = preserveIndex ? state.search.results[state.search.currentIndex] : null;
            state.search.results = buildSearchResults(tab);
            if (!state.search.results.length) {
                state.search.currentIndex = -1;
            } else if (preserveIndex && previous) {
                const nextIndex = state.search.results.findIndex(result =>
                    result.lineIndex === previous.lineIndex && result.start === previous.start && result.end === previous.end
                );
                state.search.currentIndex = nextIndex !== -1 ? nextIndex : Math.min(state.search.currentIndex, state.search.results.length - 1);
            } else {
                state.search.currentIndex = 0;
            }
            syncFindBarUi();
        }

        function revealLineInCollapsedSections(tabId, lineIndex) {
            const tab = getTabById(tabId);
            if (!tab || !tab.collapsedLines?.length) return false;
            const lines = getTabLines(tab);
            const ancestorsToOpen = [];
            for (const collapsedIndex of tab.collapsedLines) {
                if (collapsedIndex >= lineIndex) continue;
                const endIndex = getSubtreeEndIndex(lines, collapsedIndex);
                if (lineIndex <= endIndex) ancestorsToOpen.push(collapsedIndex);
            }
            if (!ancestorsToOpen.length) return false;
            const collapsedSet = getCollapsedLineSet(tab);
            ancestorsToOpen.forEach(index => collapsedSet.delete(index));
            tab.collapsedLines = [...collapsedSet].sort((a, b) => a - b);
            return true;
        }

        function selectLineRange(el, start, end) {
            if (!el) return;
            const selection = window.getSelection();
            const range = document.createRange();
            const textNode = el.firstChild || el;
            range.setStart(textNode, Math.min(start, el.textContent.length));
            range.setEnd(textNode, Math.min(end, el.textContent.length));
            selection.removeAllRanges();
            selection.addRange(range);
        }

        function goToSearchResult(index) {
            if (!state.search.results.length) return;
            const targetIndex = ((index % state.search.results.length) + state.search.results.length) % state.search.results.length;
            state.search.currentIndex = targetIndex;
            const result = state.search.results[targetIndex];
            const tab = getActiveTab();
            if (!tab) return;
            const expanded = revealLineInCollapsedSections(tab.id, result.lineIndex);
            syncFindBarUi();
            renderEditorArea();
            requestAnimationFrame(() => {
                const line = getLineEditor(tab.id, result.lineIndex);
                if (!line) return;
                state.activeLineIndex = result.lineIndex;
                line.focus({ preventScroll: true });
                requestAnimationFrame(() => {
                    selectLineRange(line, result.start, result.end);
                    line.scrollIntoView({ block: 'center', behavior: expanded ? 'auto' : 'smooth' });
                });
            });
        }

        function openFindBar() {
            state.search.open = true;
            refreshSearchResults({ preserveIndex: true });
            syncFindBarUi();
            requestAnimationFrame(() => {
                const input = document.getElementById('find-input');
                if (!input) return;
                input.focus();
                input.select();
            });
        }

        function closeFindBar() {
            state.search.open = false;
            state.search.currentIndex = state.search.results.length ? state.search.currentIndex : -1;
            syncFindBarUi();
            renderEditorArea();
        }

        function markManualSave(tabId = state.activeTabId) {
            const tab = getTabById(tabId);
            if (!tab) return;
            tab.manualSavedContent = tab.content;
            tab.manualSavedAt = Date.now();
            invalidateTabCaches(tabId);
            saveToStorage();
            requestRender('editor');
        }

        function markManualSaveAll() {
            const now = Date.now();
            state.tabs.forEach(tab => {
                tab.manualSavedContent = tab.content;
                tab.manualSavedAt = now;
                invalidateTabCaches(tab.id);
            });
            saveToStorage();
            requestRender('editor');
        }

        function restoreLastManualSave(tabId = state.activeTabId) {
            const tab = getTabById(tabId);
            if (!tab) return;
            const savedContent = getManualSavedContent(tab);
            if (tab.content === savedContent) return;
            recordTabHistory(tabId);
            tab.collapsedLines = [];
            updateTabLines(tabId, getCachedLines(savedContent, `${tabId}:restore`), 0, 0);
        }

        function ensureTabHistory(tabId) {
            if (!historyByTab[tabId]) historyByTab[tabId] = { undo: [], redo: [] };
            return historyByTab[tabId];
        }

        function snapshotTabState(tabId) {
            const tab = getTabById(tabId);
            if (!tab) return null;
            return {
                content: tab.content,
                collapsedLines: [...(tab.collapsedLines || [])],
                activeLineIndex: state.activeTabId === tabId ? state.activeLineIndex : 0
            };
        }

        function sameTabSnapshot(a, b) {
            if (!a || !b) return false;
            return a.content === b.content
                && JSON.stringify(a.collapsedLines) === JSON.stringify(b.collapsedLines)
                && a.activeLineIndex === b.activeLineIndex;
        }

        function recordTabHistory(tabId, snapshot = snapshotTabState(tabId)) {
            if (suppressHistory || !snapshot) return;
            const history = ensureTabHistory(tabId);
            const last = history.undo[history.undo.length - 1];
            if (sameTabSnapshot(last, snapshot)) return;
            history.undo.push(snapshot);
            if (history.undo.length > 100) history.undo.shift();
            history.redo = [];
        }

        function restoreTabHistory(tabId, direction) {
            const tab = getTabById(tabId);
            if (!tab) return;
            const history = ensureTabHistory(tabId);
            const source = direction === 'undo' ? history.undo : history.redo;
            if (!source.length) return;

            const current = snapshotTabState(tabId);
            const target = source.pop();
            const other = direction === 'undo' ? history.redo : history.undo;
            if (current) other.push(current);

            suppressHistory = true;
            tab.content = target.content;
            tab.collapsedLines = [...target.collapsedLines];
            state.activeTabId = tabId;
            state.activeLineIndex = target.activeLineIndex;
            updateContent(tabId, tab.content);
            renderEditorArea();
            saveToStorage();
            suppressHistory = false;

            requestAnimationFrame(() => {
                const line = getLineEditor(tabId, state.activeLineIndex);
                if (!line) return;
                line.focus({ preventScroll: true });
                placeCaret(line, line.textContent.length);
            });
        }

        function getVisibleLineState(tab) {
            const cacheKey = getVisibleStateCacheKey(tab);
            if (visibleStateCache.has(cacheKey)) return visibleStateCache.get(cacheKey);
            const lines = getTabLines(tab);
            const collapsed = getCollapsedLineSet(tab);
            const visible = [];
            let hiddenDepth = null;

            for (let i = 0; i < lines.length; i++) {
                const depth = getLineDepth(lines[i]);
                const attention = getAttentionType(lines[i]);
                if (hiddenDepth !== null && depth > hiddenDepth && !attention) continue;
                if (hiddenDepth !== null && depth <= hiddenDepth) hiddenDepth = null;

                const descendantCount = getDescendantCount(lines, i);
                const isCollapsed = collapsed.has(i) && descendantCount >= 3;
                visible.push({
                    index: i,
                    raw: lines[i],
                    depth,
                    text: getDisplayText(lines[i]),
                    descendantCount,
                    isCollapsed,
                    showToggle: descendantCount >= 3,
                    attention
                });

                if (isCollapsed) hiddenDepth = depth;
            }

            const result = { lines, visible };
            visibleStateCache.set(cacheKey, result);
            return result;
        }

        function updateTabLines(tabId, lines, focusLineIndex = state.activeLineIndex, caretOffset = 0) {
            const tab = getTabById(tabId);
            if (!tab) return;
            tab.content = lines.join('\n');
            invalidateTabCaches(tabId);
            state.activeLineIndex = Math.max(0, Math.min(focusLineIndex, lines.length - 1));
            state.pendingCaret = {
                tabId,
                lineIndex: state.activeLineIndex,
                offset: Math.max(0, caretOffset)
            };
            updateContent(tabId, tab.content);
            renderEditorArea();
            requestAnimationFrame(() => {
                const line = getLineEditor(tabId, state.activeLineIndex);
                if (!line) return;
                line.focus({ preventScroll: true });
            });
        }

        function toggleCollapsedLine(tabId, lineIndex, options = {}) {
            const tab = getTabById(tabId);
            if (!tab) return;
            if (options.record !== false) recordTabHistory(tabId);
            const set = getCollapsedLineSet(tab);
            if (set.has(lineIndex)) set.delete(lineIndex);
            else set.add(lineIndex);
            tab.collapsedLines = [...set].sort((a, b) => a - b);
            invalidateTabCaches(tabId);
            saveToStorage();
            renderEditorArea();
        }

        function setSelectedLineRange(tabId, start, end) {
            state.selectedLineRange = {
                tabId,
                start: Math.min(start, end),
                end: Math.max(start, end)
            };
        }

        function clearSelectedLineRange() {
            state.selectedLineRange = null;
        }

        function endDragSelection() {
            if (state.dragMove) {
                finishLineDragMove();
                return;
            }
            state.pendingLineDrag = null;
            if (state.dragSelecting && !state.dragSelecting.moved) {
                clearSelectedLineRange();
            }
            state.dragSelecting = null;
        }

        function handlePendingLineDrag(e) {
            if (!state.pendingLineDrag || state.dragMove) return;
            const dx = Math.abs(e.clientX - state.pendingLineDrag.startX);
            const dy = Math.abs(e.clientY - state.pendingLineDrag.startY);
            if (Math.max(dx, dy) < 6) return;
            const { tabId, lineIndex } = state.pendingLineDrag;
            state.pendingLineDrag = null;
            window.getSelection()?.removeAllRanges();
            startLineDragMove(tabId, lineIndex);
        }

        function getDragMoveRange(tabId, lineIndex) {
            const selectedRange = state.selectedLineRange && state.selectedLineRange.tabId === tabId ? state.selectedLineRange : null;
            if (selectedRange && lineIndex >= selectedRange.start && lineIndex <= selectedRange.end) {
                return { start: selectedRange.start, end: selectedRange.end };
            }
            const tab = getTabById(tabId);
            const lines = getTabLines(tab);
            return { start: lineIndex, end: getSubtreeEndIndex(lines, lineIndex) };
        }

        function moveLineBlockWithState(lines, collapsedLines, start, end, targetIndex) {
            if (targetIndex > start && targetIndex <= end + 1) {
                return { lines, collapsedLines, movedStart: start };
            }

            const entries = lines.map((text, index) => ({
                text,
                collapsed: collapsedLines.includes(index)
            }));
            const moved = entries.slice(start, end + 1);
            const remaining = entries.slice(0, start).concat(entries.slice(end + 1));
            const adjustedTarget = targetIndex > end ? targetIndex - (end - start + 1) : targetIndex;
            remaining.splice(adjustedTarget, 0, ...moved);

            return {
                lines: remaining.map(entry => entry.text),
                collapsedLines: remaining.map((entry, index) => entry.collapsed ? index : -1).filter(index => index !== -1),
                movedStart: adjustedTarget
            };
        }

        function startLineDragMove(tabId, lineIndex) {
            const range = getDragMoveRange(tabId, lineIndex);
            state.dragSelecting = null;
            state.dragMove = {
                tabId,
                start: range.start,
                end: range.end,
                targetIndex: range.end + 1,
                hoverIndex: range.end,
                position: 'after'
            };
            clearSelectedLineRange();
            renderEditorArea();
        }

        function updateLineDragMoveTarget(tabId, hoverIndex, position) {
            if (!state.dragMove || state.dragMove.tabId !== tabId) return;
            state.dragMove.hoverIndex = hoverIndex;
            state.dragMove.position = position;
            state.dragMove.targetIndex = position === 'before' ? hoverIndex : hoverIndex + 1;
            renderEditorArea();
        }

        function finishLineDragMove() {
            if (!state.dragMove) return;
            const { tabId, start, end, targetIndex } = state.dragMove;
            const tab = getTabById(tabId);
            state.dragMove = null;
            if (!tab) return;

            const currentLines = getTabLines(tab);
            const currentCollapsed = [...(tab.collapsedLines || [])];
            const moved = moveLineBlockWithState(currentLines, currentCollapsed, start, end, targetIndex);
            if (moved.lines === currentLines) {
                renderEditorArea();
                return;
            }

            recordTabHistory(tabId);
            tab.collapsedLines = moved.collapsedLines;
            updateTabLines(tabId, moved.lines, moved.movedStart, 0);
        }

        function shiftLineRange(lines, startIndex, endIndex, delta) {
            const nextLines = [...lines];
            for (let i = startIndex; i <= endIndex; i++) {
                const depth = getLineDepth(nextLines[i]);
                if (delta < 0 && depth === 0) continue;
                nextLines[i] = delta < 0 ? nextLines[i].replace(/^\t/, '') : "\t" + nextLines[i];
            }
            return nextLines;
        }

        function shiftOutlineRange(lines, startIndex, endIndex, delta, shouldNormalize) {
            const shifted = shiftLineRange(lines, startIndex, endIndex, delta);
            return shouldNormalize ? normalizeOutlineLines(shifted, []) : shifted;
        }

        function handleSelectedRangeTab(e) {
            if (e.key !== 'Tab' || !state.selectedLineRange) return;
            const tab = getTabById(state.selectedLineRange.tabId);
            if (!tab) return;
            e.preventDefault();
            const currentLines = getTabLines(tab);
            const nextLines = shiftOutlineRange(
                currentLines,
                state.selectedLineRange.start,
                state.selectedLineRange.end,
                e.shiftKey ? -1 : 1,
                tab.outlineModeActive && !state.tempOutlineDisabled
            );
            const focusLine = state.selectedLineRange.start;
            clearSelectedLineRange();
            updateTabLines(tab.id, nextLines, focusLine, 0);
        }

        function handleSelectedRangeDelete(e) {
            if (!state.selectedLineRange) return;
            if (e.key !== 'Backspace' && e.key !== 'Delete') return;
            e.preventDefault();
            deleteSelectedRangeLines();
        }

        function handleUndoRedoShortcuts(e) {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                restoreTabHistory(state.activeTabId, 'undo');
                return;
            }
            if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
                e.preventDefault();
                restoreTabHistory(state.activeTabId, 'redo');
            }
        }

        function handleManualSaveShortcut(e) {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
            e.preventDefault();
            markManualSave(state.activeTabId);
        }

        function handleFindShortcuts(e) {
            const isMod = e.ctrlKey || e.metaKey;
            if (isMod && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                openFindBar();
                return;
            }
            if (e.key === 'F3') {
                e.preventDefault();
                if (!state.search.open) openFindBar();
                else goToSearchResult(state.search.currentIndex + 1);
                return;
            }
            if (e.key === 'Escape' && state.search.open && document.activeElement?.id === 'find-input') {
                e.preventDefault();
                closeFindBar();
            }
        }

        function getSelectedRangeTab() {
            return state.selectedLineRange ? getTabById(state.selectedLineRange.tabId) : null;
        }

        function normalizeClipboardText(text) {
            return (text || '').replace(/\r\n?/g, '\n');
        }

        function getSelectedRangeLines(tab) {
            if (!tab || !state.selectedLineRange || state.selectedLineRange.tabId !== tab.id) return [];
            const lines = getTabLines(tab);
            return lines.slice(state.selectedLineRange.start, state.selectedLineRange.end + 1);
        }

        function deleteSelectedRangeLines() {
            const tab = getSelectedRangeTab();
            if (!tab) return;
            const currentLines = getTabLines(tab);
            const start = state.selectedLineRange.start;
            const end = state.selectedLineRange.end;
            const remainingLines = currentLines.filter((_, index) => index < start || index > end);
            const nextLines = remainingLines.length ? remainingLines : [''];
            const focusLine = Math.max(0, Math.min(start, nextLines.length - 1));
            clearSelectedLineRange();
            updateTabLines(tab.id, nextLines, focusLine, 0);
        }

        function handleSelectedRangeCopy(e) {
            const tab = getSelectedRangeTab();
            if (!tab) return;
            const text = getSelectedRangeLines(tab).join('\n');
            if (!text) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', text);
        }

        function handleSelectedRangeCut(e) {
            const tab = getSelectedRangeTab();
            if (!tab) return;
            const text = getSelectedRangeLines(tab).join('\n');
            if (!text) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', text);
            deleteSelectedRangeLines();
        }

        function handleSelectedRangePaste(e) {
            const tab = getSelectedRangeTab();
            if (!tab) return;
            const pasted = normalizeClipboardText(e.clipboardData.getData('text/plain'));
            if (!pasted) return;
            e.preventDefault();
            const currentLines = getTabLines(tab);
            const start = state.selectedLineRange.start;
            const end = state.selectedLineRange.end;
            const incomingLines = pasted.split('\n');
            const nextLines = [
                ...currentLines.slice(0, start),
                ...incomingLines,
                ...currentLines.slice(end + 1)
            ];
            clearSelectedLineRange();
            updateTabLines(tab.id, nextLines, start + incomingLines.length - 1, incomingLines[incomingLines.length - 1].length);
        }

        function updateHoveredLineDragReady(isShiftHeld) {
            if (!state.hoveredLineKey) return;
            const line = document.querySelector(`[data-tab-line="${state.hoveredLineKey}"]`);
            if (!line) return;
            if (isShiftHeld) line.classList.add('drag-ready');
            else line.classList.remove('drag-ready');
        }

        function hydrateTabs(savedTabs) {
            if (!Array.isArray(savedTabs) || savedTabs.length === 0) return [createDefaultTab()];

            const hydrated = savedTabs
                .filter(tab => tab && typeof tab === 'object')
                .map((tab, index) => ({
                    id: typeof tab.id === 'string' && tab.id ? tab.id : String(Date.now() + index),
                    title: typeof tab.title === 'string' && tab.title ? tab.title : 'untitled.txt',
                    content: typeof tab.content === 'string' ? tab.content : '',
                    manuallyRenamed: Boolean(tab.manuallyRenamed),
                    showLineNumbers: tab.showLineNumbers !== false,
                    showZebra: tab.showZebra !== false,
                    outlineModeActive: tab.outlineModeActive !== false,
                    collapsedLines: Array.isArray(tab.collapsedLines) ? tab.collapsedLines.filter(Number.isInteger) : [],
                    manualSavedContent: typeof tab.manualSavedContent === 'string' ? tab.manualSavedContent : (typeof tab.content === 'string' ? tab.content : ''),
                    manualSavedAt: typeof tab.manualSavedAt === 'number' ? tab.manualSavedAt : Date.now()
                }));

            return hydrated.length ? hydrated : [createDefaultTab()];
        }

        function numToRoman(n, lower = false) { 
            const val = n > 0 && n <= ROMAN.length ? ROMAN[n - 1] : null;
            return val && lower ? val.toLowerCase() : val;
        }

        function render() {
            requestRender('full', { immediate: true });
        }

        function renderTabs() {
            const container = document.getElementById('tabs-container');
            if (!container) return;
            container.innerHTML = '';
            state.tabs.forEach((tab) => {
                const active = state.activeTabId === tab.id;
                const mvIndex = state.multiViewIds.indexOf(tab.id);
                const isSelected = mvIndex !== -1;
                const el = document.createElement('div');
                el.draggable = true;
                el.className = "group flex items-center h-8 px-3 mr-0.5 cursor-pointer text-xs select-none tab-btn " + (active ? 'tab-active shadow-sm' : 'tab-inactive');
                
                if (state.theme.orientation === 'horizontal') el.classList.add('min-w-[120px]');
                
                el.ondragstart = (e) => { draggedTabId = tab.id; el.classList.add('tab-dragging'); e.dataTransfer.effectAllowed = 'move'; };
                el.ondragend = () => { el.classList.remove('tab-dragging'); draggedTabId = null; };
                el.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
                el.ondrop = (e) => {
                    e.preventDefault();
                    if (!draggedTabId || draggedTabId === tab.id) return;
                    const fromIdx = state.tabs.findIndex(t => t.id === draggedTabId);
                    const toIdx = state.tabs.findIndex(t => t.id === tab.id);
                    const [moved] = state.tabs.splice(fromIdx, 1);
                    state.tabs.splice(toIdx, 0, moved);
                    saveToStorage();
                    requestRender('full');
                };

                el.onclick = () => {
                    if (state.activeTabId === tab.id) return;
                    state.activeTabId = tab.id;
                    requestRender('full');
                };
                
                el.innerHTML = `
                    <button class="mv-toggle mr-2 w-4 h-4 flex items-center justify-center rounded border transition-colors text-current ${isSelected ? 'border-accent font-bold text-[10px]' : 'border-transparent opacity-60 hover:opacity-100'}">
                        ${isSelected ? (mvIndex + 1) : '<div class="w-1.5 h-1.5 rounded-full border border-current"></div>'}
                    </button>
                    <span class="tab-title truncate flex-1">${tab.title}</span>
                    <button class="close-tab ml-2 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                `;

                el.querySelector('.mv-toggle').onclick = (e) => { e.stopPropagation(); toggleMultiView(tab.id); };
                const titleEl = el.querySelector('.tab-title');
                const beginRename = (e) => {
                    e.stopPropagation();
                    state.activeTabId = tab.id;
                    startInlineRenameTab(tab.id, titleEl);
                };
                let hoverStart = 0;
                let hoverTimer = null;
                titleEl.onmouseenter = () => {
                    hoverStart = Date.now();
                    hoverTimer = setTimeout(() => titleEl.classList.add('rename-ready'), TAB_RENAME_HOVER_MS);
                };
                titleEl.onmouseleave = () => {
                    hoverStart = 0;
                    titleEl.classList.remove('rename-ready');
                    if (hoverTimer) clearTimeout(hoverTimer);
                };
                titleEl.onclick = (e) => {
                    const hoveredLongEnough = hoverStart && (Date.now() - hoverStart) >= TAB_RENAME_HOVER_MS;
                    if (!hoveredLongEnough || !titleEl.classList.contains('rename-ready')) return;
                    beginRename(e);
                };
                el.querySelector('.close-tab').onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
                container.appendChild(el);
            });
            lucide.createIcons();
        }

        function toggleMultiView(id) {
            const idx = state.multiViewIds.indexOf(id);
            if (idx !== -1) state.multiViewIds.splice(idx, 1);
            else if (state.multiViewIds.length < 4) state.multiViewIds.push(id);
            saveToStorage();
            requestRender('full');
        }

        function createEditorElement(tab) {
            const wrap = document.createElement('div');
            wrap.className = "flex-1 overflow-auto relative h-full editor-cell";
            const root = document.createElement('div');
            root.className = "outline-root h-full " + (tab.showZebra ? 'zebra-mode' : '');
            const { lines, visible } = getVisibleLineState(tab);
            const savedLines = getManualSavedLines(tab);

            visible.forEach((node, visibleIndex) => {
                const row = document.createElement('div');
                row.className = "outline-row" + (node.isCollapsed ? " collapsed-parent" : "");
                row.dataset.rowIndex = String(node.index);
                row.dataset.tabId = tab.id;
                const selectedRange = state.selectedLineRange && state.selectedLineRange.tabId === tab.id ? state.selectedLineRange : null;
                const isRowSelected = selectedRange && node.index >= selectedRange.start && node.index <= selectedRange.end;
                if (isRowSelected) row.classList.add('row-selected');
                if (state.dragMove && state.dragMove.tabId === tab.id && node.index >= state.dragMove.start && node.index <= state.dragMove.end) {
                    row.classList.add('drag-source');
                }
                if (node.attention === 'question') row.classList.add('attention-question');
                if (node.attention === 'urgent') row.classList.add('attention-urgent');
                if ((lines[node.index] || '') !== (savedLines[node.index] || '')) row.classList.add('revision-changed');
                if (state.dragMove && state.dragMove.tabId === tab.id && state.dragMove.hoverIndex === node.index) {
                    row.classList.add(state.dragMove.position === 'before' ? 'drop-before' : 'drop-after');
                }

                if (tab.showLineNumbers) {
                    const gutter = document.createElement('div');
                    gutter.className = 'outline-gutter';
                    if (node.showToggle) {
                        const toggle = document.createElement('span');
                        toggle.className = 'outline-toggle';
                        toggle.textContent = node.isCollapsed ? '+' : 'âˆ’';
                        toggle.textContent = node.isCollapsed ? '+' : '-';
                        toggle.onclick = (e) => {
                            e.stopPropagation();
                            toggleCollapsedLine(tab.id, node.index);
                        };
                        gutter.appendChild(toggle);
                    }
                    const label = document.createElement('span');
                    label.textContent = String(node.index + 1);
                    gutter.appendChild(label);
                    gutter.onmousedown = (e) => e.stopPropagation();
                    row.appendChild(gutter);
                }

                const line = document.createElement('div');
                line.contentEditable = "true";
                line.spellcheck = false;
                line.dataset.tabLine = `${tab.id}:${node.index}`;
                line.dataset.lineIndex = String(node.index);
                line.className = "outline-line" + (node.text ? "" : " empty");
                line.style.paddingLeft = `calc(${node.depth} * 20px + var(--text-indent))`;
                setLineDisplayContent(line, node.text, false, node.index);
                applyIndentGuides(line, node.depth);

                line.onfocus = () => {
                    state.activeTabId = tab.id;
                    state.activeLineIndex = node.index;
                    const selection = window.getSelection();
                    const hadCaretInLine = Boolean(selection && selection.rangeCount && line.contains(selection.anchorNode));
                    const caretOffset = hadCaretInLine ? getCaretOffset(line) : null;
                    setLineDisplayContent(line, node.text, true);
                    const pendingCaret = state.pendingCaret
                        && state.pendingCaret.tabId === tab.id
                        && state.pendingCaret.lineIndex === node.index
                        ? state.pendingCaret
                        : null;
                    const targetOffset = pendingCaret ? pendingCaret.offset : caretOffset;
                    if (pendingCaret) state.pendingCaret = null;
                    if (targetOffset !== null) {
                        requestAnimationFrame(() => placeCaret(line, targetOffset));
                    }
                    if (state.preserveSelectionOnFocus) state.preserveSelectionOnFocus = false;
                    else if (!state.dragSelecting) clearSelectedLineRange();
                    updateToolbarUI();
                };

                line.onblur = () => {
                    setLineDisplayContent(line, line.textContent || '', false, node.index);
                };

                line.onmouseenter = () => {
                    state.hoveredLineKey = `${tab.id}:${node.index}`;
                    line.classList.remove('drag-ready');
                };
                line.onmouseleave = () => {
                    if (state.hoveredLineKey === `${tab.id}:${node.index}`) state.hoveredLineKey = null;
                    line.classList.remove('drag-ready');
                };

                line.onmousedown = (e) => {
                    if (e.button !== 0) return;
                    const selectedRange = state.selectedLineRange && state.selectedLineRange.tabId === tab.id ? state.selectedLineRange : null;
                    const rowIsSelected = selectedRange && node.index >= selectedRange.start && node.index <= selectedRange.end;
                    if (e.shiftKey && (line.classList.contains('drag-ready') || rowIsSelected)) {
                        e.stopPropagation();
                        state.activeTabId = tab.id;
                        state.activeLineIndex = node.index;
                        state.pendingLineDrag = { tabId: tab.id, lineIndex: node.index, startX: e.clientX, startY: e.clientY };
                    } else {
                        state.pendingLineDrag = null;
                    }
                };

                row.onmousedown = (e) => {
                    if (e.button !== 0) return;
                    state.activeTabId = tab.id;
                    state.activeLineIndex = node.index;
                    clearSelectedLineRange();
                    state.dragSelecting = { tabId: tab.id, anchor: node.index, moved: false };
                };

                row.onmouseenter = () => {
                    if (state.dragMove && state.dragMove.tabId === tab.id) {
                        if (node.isCollapsed) {
                            toggleCollapsedLine(tab.id, node.index, { record: false });
                            return;
                        }
                        updateLineDragMoveTarget(tab.id, node.index, 'after');
                        return;
                    }
                    if (!state.dragSelecting || state.dragSelecting.tabId !== tab.id) return;
                    if (!state.dragSelecting.moved && state.dragSelecting.anchor === node.index) return;
                    state.dragSelecting.moved = true;
                    setSelectedLineRange(tab.id, state.dragSelecting.anchor, node.index);
                    renderEditorArea();
                };

                row.onmousemove = (e) => {
                    if (!state.dragMove || state.dragMove.tabId !== tab.id) return;
                    const rect = row.getBoundingClientRect();
                    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    updateLineDragMoveTarget(tab.id, node.index, position);
                };

                line.oninput = (e) => {
                    const rawText = e.currentTarget.textContent || '';
                    const sanitizedText = rawText.replace(/\r?\n/g, '');
                    if (rawText !== sanitizedText) {
                        e.currentTarget.textContent = sanitizedText;
                        placeCaret(e.currentTarget, sanitizedText.length);
                    }
                    const nextLines = [...getTabLines(getTabById(tab.id))];
                    nextLines[node.index] = "\t".repeat(node.depth) + sanitizedText;
                    e.currentTarget.classList.toggle('empty', !sanitizedText);
                    updateContent(tab.id, nextLines.join('\n'));
                };

                line.onpaste = (e) => {
                    const pasted = normalizeClipboardText(e.clipboardData.getData('text/plain'));
                    if (!pasted) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const currentLines = getTabLines(getTabById(tab.id));
                    const currentText = e.currentTarget.textContent || '';
                    const caretOffset = getCaretOffset(e.currentTarget);
                    const left = currentText.slice(0, caretOffset);
                    const right = currentText.slice(caretOffset);
                    const incomingLines = pasted.split('\n');
                    const nextLines = [...currentLines];

                    if (incomingLines.length === 1) {
                        nextLines[node.index] = "\t".repeat(node.depth) + left + incomingLines[0] + right;
                        updateTabLines(tab.id, nextLines, node.index, left.length + incomingLines[0].length);
                        return;
                    }

                    nextLines[node.index] = "\t".repeat(node.depth) + left + incomingLines[0];
                    const middleLines = incomingLines.slice(1, -1).map(text => "\t".repeat(node.depth) + text);
                    const lastLine = "\t".repeat(node.depth) + incomingLines[incomingLines.length - 1] + right;
                    nextLines.splice(node.index + 1, 0, ...middleLines, lastLine);
                    updateTabLines(tab.id, nextLines, node.index + incomingLines.length - 1, incomingLines[incomingLines.length - 1].length);
                };

                line.onkeydown = (e) => {
                    const currentLines = getTabLines(getTabById(tab.id));
                    const currentText = e.currentTarget.textContent;
                    const caretOffset = getCaretOffset(e.currentTarget);
                    state.activeLineIndex = node.index;

                    if (e.key === 'Tab') {
                        e.preventDefault();
                        const selectedRange = getSelectedLineRange(tab.id);
                        if (selectedRange && (selectedRange.isMultiLine || (selectedRange.hasSelection && tab.outlineModeActive && !state.tempOutlineDisabled))) {
                            const nextLines = tab.outlineModeActive && !state.tempOutlineDisabled
                                ? shiftOutlineRange(currentLines, selectedRange.start, selectedRange.end, e.shiftKey ? -1 : 1, true)
                                : shiftLineRange(currentLines, selectedRange.start, selectedRange.end, e.shiftKey ? -1 : 1);
                            clearSelectedLineRange();
                            updateTabLines(tab.id, nextLines, selectedRange.start, 0);
                            return;
                        }
                        if (!tab.outlineModeActive || state.tempOutlineDisabled) {
                            const nextText = currentText.slice(0, caretOffset) + "\t" + currentText.slice(caretOffset);
                            const nextLines = [...currentLines];
                            nextLines[node.index] = "\t".repeat(node.depth) + nextText;
                            updateTabLines(tab.id, nextLines, node.index, caretOffset + 1);
                            return;
                        }
                        const subtreeEnd = getSubtreeEndIndex(currentLines, node.index);
                        const nextLines = shiftOutlineRange(currentLines, node.index, subtreeEnd, e.shiftKey ? -1 : 1, true);
                        updateTabLines(tab.id, nextLines, node.index, Math.max(0, caretOffset + (e.shiftKey ? -1 : 1)));
                        return;
                    }

                    if (e.key === 'Enter') {
                        e.preventDefault();
                        let marker = "";
                        let nextLineDepth = node.depth;
                        if (tab.outlineModeActive && !state.tempOutlineDisabled) {
                            const info = getSymbolInfo(currentLines[node.index]);
                            if (info) {
                                if (info.type === 'bullet') marker = formatOutlineMarker('bullet', info.value, state.norm.separator) + " ";
                                else {
                                    const counters = computeOutlineCounters(currentLines.slice(0, node.index + 1), []);
                                    const nextValue = (counters[info.indent] || 0) + 1;
                                    marker = formatOutlineMarker(getMarkerTypeForDepth(info.indent), nextValue, state.norm.separator) + " ";
                                }
                            }
                        } else {
                            nextLineDepth = 0;
                        }
                        const left = currentText.slice(0, caretOffset);
                        const right = currentText.slice(caretOffset);
                        if (node.index === 0 && !tab.manuallyRenamed) {
                            lockTabTitleFromFirstLine(tab, left);
                        }
                        const nextLines = [...currentLines];
                        nextLines[node.index] = "\t".repeat(node.depth) + left;
                        nextLines.splice(node.index + 1, 0, "\t".repeat(nextLineDepth) + marker + right);
                        updateTabLines(tab.id, nextLines, node.index + 1, marker.length);
                        return;
                    }

                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        const direction = e.key === 'ArrowUp' ? -1 : 1;
                        const targetVisibleIndex = visibleIndex + direction;
                        if (targetVisibleIndex >= 0 && targetVisibleIndex < visible.length) {
                            e.preventDefault();
                            const target = visible[targetVisibleIndex];
                            if (e.shiftKey) {
                                const existingRange = state.selectedLineRange && state.selectedLineRange.tabId === tab.id
                                    ? state.selectedLineRange
                                    : { start: node.index, end: node.index };
                                const anchor = node.index === existingRange.start ? existingRange.end : existingRange.start;
                                setSelectedLineRange(tab.id, anchor, target.index);
                                state.preserveSelectionOnFocus = true;
                                renderEditorArea();
                            } else {
                                clearSelectedLineRange();
                            }
                            state.activeLineIndex = target.index;
                            requestAnimationFrame(() => {
                                const targetLine = getLineEditor(tab.id, target.index);
                                if (!targetLine) return;
                                targetLine.focus({ preventScroll: true });
                                placeCaret(targetLine, Math.min(caretOffset, targetLine.textContent.length));
                            });
                            return;
                        }
                    }

                    if (e.key === 'Backspace' && caretOffset === 0) {
                        if (node.depth > 0) {
                            e.preventDefault();
                            const nextLines = [...currentLines];
                            nextLines[node.index] = currentLines[node.index].replace(/^\t/, '');
                            updateTabLines(tab.id, nextLines, node.index, 0);
                            return;
                        }
                        if (!currentText.length && currentLines.length > 1) {
                            e.preventDefault();
                            const nextLines = [...currentLines];
                            nextLines.splice(node.index, 1);
                            updateTabLines(tab.id, nextLines, Math.max(0, node.index - 1), getLineTextLength(nextLines, Math.max(0, node.index - 1)));
                            return;
                        }
                        const collapsedParent = visibleIndex > 0 && visible[visibleIndex - 1].index < node.index - 1 ? visible[visibleIndex - 1] : null;
                        if (collapsedParent && collapsedParent.isCollapsed) {
                            e.preventDefault();
                            toggleCollapsedLine(tab.id, collapsedParent.index);
                            return;
                        }
                    }

                    if (e.key === 'Delete' && caretOffset === currentText.length && node.index < currentLines.length - 1) {
                        e.preventDefault();
                        const nextLines = [...currentLines];
                        const currentRaw = nextLines[node.index];
                        const nextRaw = nextLines[node.index + 1];
                        const currentPrefix = currentRaw.match(/^\t*/)?.[0] || '';
                        const mergedText = getDisplayText(currentRaw) + getDisplayText(nextRaw);
                        nextLines[node.index] = currentPrefix + mergedText;
                        nextLines.splice(node.index + 1, 1);
                        updateTabLines(tab.id, nextLines, node.index, currentText.length);
                        return;
                    }

                    if (e.key === 'Delete' && !currentText.length && currentLines.length > 1) {
                        e.preventDefault();
                        const nextLines = [...currentLines];
                        nextLines.splice(node.index, 1);
                        updateTabLines(tab.id, nextLines, Math.max(0, node.index - 1), getLineTextLength(nextLines, Math.max(0, node.index - 1)));
                        return;
                    }
                };

                row.appendChild(line);
                root.appendChild(row);
            });

            wrap.appendChild(root);
            return wrap;
        }

        function renderEditorArea() {
            const container = document.getElementById('editor-container');
            if (!container) return;
            container.innerHTML = '';
            if (state.multiViewIds.length > 1) {
                const grid = document.createElement('div');
                const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-gap-color').trim();
                grid.style.backgroundColor = gridColor;
                grid.className = "grid h-full w-full gap-px";
                if (state.multiViewMode === 'horiz') grid.className += " grid-cols-1 grid-rows-" + state.multiViewIds.length;
                else if (state.multiViewMode === 'vert') grid.className += " grid-cols-" + state.multiViewIds.length + " grid-rows-1";
                else grid.className += " grid-cols-2 grid-rows-2";
                state.multiViewIds.forEach(id => {
                    const tab = state.tabs.find(t => t.id === id);
                    if (tab) {
                        const cell = document.createElement('div');
                        cell.className = "flex flex-col h-full overflow-hidden";
                        cell.innerHTML = `<div class="mv-cell-header px-3 py-1 flex justify-between items-center font-bold uppercase shrink-0"><span>${tab.title}</span></div>`;
                        cell.appendChild(createEditorElement(tab)); 
                        grid.appendChild(cell);
                    }
                });
                container.appendChild(grid);
            } else {
                const activeTab = state.tabs.find(t => t.id === state.activeTabId);
                if (activeTab) container.appendChild(createEditorElement(activeTab));
            }
            if (state.dragMove) {
                const badge = document.createElement('div');
                const movedCount = state.dragMove.end - state.dragMove.start + 1;
                badge.className = 'drag-status';
                badge.textContent = `Moving ${movedCount} line${movedCount === 1 ? '' : 's'}`;
                container.appendChild(badge);
            }
        }

        function updateToolbarUI() {
            const t = getActiveTab();
            if (!t) return;
            
            // Standard Toggles
            const toggles = [
                {id: 'toggle-line-numbers', active: t.showLineNumbers}, 
                {id: 'toggle-zebra', active: t.showZebra}, 
                {id: 'toggle-outline-mode', active: t.outlineModeActive}
            ];
            
            toggles.forEach(item => {
                const btn = document.getElementById(item.id);
                if (btn) {
                    if (item.active) btn.classList.add('btn-active');
                    else btn.classList.remove('btn-active');
                }
            });

            const orientBtn = document.getElementById('toggle-tab-orientation');
            const isVertical = state.theme.orientation === 'vertical';
            const orientIcon = document.getElementById('orient-icon');
            if (isVertical) {
                orientBtn.classList.add('btn-active');
                orientIcon.innerHTML = `<rect x="10" y="4" width="10" height="16" rx="1" fill="none" stroke="currentColor"/><rect x="4" y="6" width="4" height="3" rx="0.5" fill="currentColor"/><rect x="4" y="10" width="4" height="3" rx="0.5" fill="currentColor"/><rect x="4" y="14" width="4" height="3" rx="0.5" fill="currentColor"/>`;
            } else {
                orientBtn.classList.remove('btn-active');
                orientIcon.innerHTML = `<rect x="4" y="10" width="16" height="10" rx="1" fill="none" stroke="currentColor"/><rect x="6" y="4" width="3" height="4" rx="0.5" fill="currentColor"/><rect x="10" y="4" width="3" height="4" rx="0.5" fill="currentColor"/><rect x="14" y="4" width="3" height="4" rx="0.5" fill="currentColor"/>`;
            }

            // Stats Update
            const content = t.content;
            const words = content.trim() ? content.trim().split(/\s+/).length : 0;
            const chars = content.length;
            const lines = getCachedLines(content, `${t.id}:stats`).length;
            const readTime = Math.ceil(words / 200) || 1;

            document.getElementById('status-filename').innerText = t.title;
            document.getElementById('stat-lines').innerText = lines;
            document.getElementById('stat-words').innerText = words;
            document.getElementById('stat-chars').innerText = chars;
            document.getElementById('stat-time').innerText = readTime + "m";

            const mvBtn = document.getElementById('toggle-view-mode');
            if (state.multiViewIds.length > 1) {
                mvBtn.classList.remove('hidden');
                const icon = state.multiViewMode === 'horiz' ? 'rows' : (state.multiViewMode === 'card' ? 'layout-grid' : 'columns');
                document.getElementById('view-mode-icon').setAttribute('data-lucide', icon);
            } else mvBtn.classList.add('hidden');

            const history = ensureTabHistory(t.id);
            document.getElementById('undo-btn').disabled = history.undo.length === 0;
            document.getElementById('redo-btn').disabled = history.redo.length === 0;
            document.getElementById('manual-save-btn').title = isTabDirty(t)
                ? `Save (last saved ${formatManualSaveTime(t.manualSavedAt)})`
                : `Saved ${formatManualSaveTime(t.manualSavedAt)}`;
            document.getElementById('manual-save-all-btn').title = areAnyTabsDirty()
                ? 'Save All'
                : 'All Tabs Saved';
            document.getElementById('restore-save-btn').disabled = !isTabDirty(t);
            document.getElementById('restore-save-btn').title = isTabDirty(t)
                ? `Jump Back To Last Save (${formatManualSaveTime(t.manualSavedAt)})`
                : 'Already At Last Save';
            document.getElementById('save-status').innerText = isTabDirty(t)
                ? 'Autosaved · Revision pending'
                : `Revision saved ${formatManualSaveTime(t.manualSavedAt)}`;
            document.getElementById('open-find-btn').classList.toggle('btn-active', state.search.open);

            document.getElementById('zip-export-toggle').checked = state.theme.zipExport;
            
            lucide.createIcons();
        }

        function triggerDownload(filename, content) {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.endsWith('.txt') ? filename : filename + '.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }

        async function exportAll() {
            if (state.theme.zipExport) {
                const zip = new JSZip();
                state.tabs.forEach(tab => {
                    const name = tab.title.endsWith('.txt') ? tab.title : tab.title + '.txt';
                    zip.file(name, tab.content);
                });
                const blob = await zip.generateAsync({ type: "blob" });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = "tabForge_Export.zip";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } else {
                state.tabs.forEach((tab, index) => {
                    setTimeout(() => {
                        triggerDownload(tab.title, tab.content);
                    }, index * 200);
                });
            }
            markManualSaveAll();
        }

        function getMarkerTypeForDepth(depth) {
            const levels = getOutlineLevels();
            return levels[Math.max(depth, 0) % levels.length];
        }

        function getLineRange(text, start, end) {
            const lineStart = text.lastIndexOf('\n', Math.max(0, start) - 1) + 1;
            let lineEnd = text.indexOf('\n', Math.max(end, start));
            if (lineEnd === -1) lineEnd = text.length;
            return { lineStart, lineEnd };
        }

        function getLineEndFromStart(text, start) {
            const nextNewline = text.indexOf('\n', start);
            return nextNewline === -1 ? text.length : nextNewline;
        }

        function getSymbolInfo(line) {
            const raw = line.replace(/^\t+/, ''), indent = line.length - raw.length;
            const bulletMatch = raw.match(/^([\-\*\+])(\s+)/);
            const parenMatch = raw.match(/^\((\d+|[a-zA-Z]{1}|[IVXLCDMivxlcdm]+)\)(\s+)/);
            const seqMatch = raw.match(/^(\d+|[a-zA-Z]{1}|[IVXLCDMivxlcdm]+)([\.\-\)]?)(\s+)/);
            if (bulletMatch) return { type: 'bullet', value: bulletMatch[1], fullSymbol: bulletMatch[1], indent, isStart: true, trailingSpace: bulletMatch[2] };
            if (parenMatch) {
                const char = parenMatch[1], space = parenMatch[2];
                if (/^\d+$/.test(char)) return { type: 'number-paren', value: parseInt(char), fullSymbol: `(${char})`, indent, isStart: parseInt(char) === 1, trailingSpace: space };
                if (ROMAN.includes(char.toUpperCase())) {
                    const isLower = char === char.toLowerCase();
                    const val = isLower ? ROMAN.map(r => r.toLowerCase()).indexOf(char) + 1 : ROMAN.indexOf(char.toUpperCase()) + 1;
                    return { type: isLower ? 'roman-lower-paren' : 'roman-paren', value: val, fullSymbol: `(${char})`, indent, isStart: val === 1, trailingSpace: space };
                }
                if (/^[a-zA-Z]$/.test(char)) {
                    const isLower = char === char.toLowerCase(), val = char.toLowerCase().charCodeAt(0) - 96;
                    return { type: isLower ? 'alpha-paren' : 'alpha-upper-paren', value: val, fullSymbol: `(${char})`, indent, isStart: val === 1, trailingSpace: space };
                }
            }
            if (seqMatch) {
                const char = seqMatch[1], sep = seqMatch[2], space = seqMatch[3];
                if (/^\d+$/.test(char)) return { type: 'number-dot', value: parseInt(char), fullSymbol: char + sep, indent, isStart: parseInt(char) === 1, trailingSpace: space };
                if (ROMAN.includes(char.toUpperCase())) {
                    const isLower = char === char.toLowerCase(), val = isLower ? ROMAN.map(r=>r.toLowerCase()).indexOf(char)+1 : ROMAN.indexOf(char.toUpperCase())+1;
                    return { type: isLower ? 'roman-lower-dot' : 'roman-dot', value: val, fullSymbol: char + sep, indent, isStart: val === 1, trailingSpace: space };
                }
                if (/^[a-zA-Z]$/.test(char)) {
                    const isLower = char === char.toLowerCase(), val = char.toLowerCase().charCodeAt(0) - 96;
                    return { type: isLower ? 'alpha-dot' : 'alpha-upper-dot', value: val, fullSymbol: char + sep, indent, isStart: val === 1, trailingSpace: space };
                }
            }
            return null;
        }

        function stripOutlinePrefix(line, info) {
            if (!info) return line.replace(/^\t+/, '');
            return line.replace(/^\t+/, '').replace(info.fullSymbol, '').trimStart();
        }

        function formatOutlineMarker(type, value, separator) {
            if (type === 'bullet') return value;
            if (type === 'number-dot') return value + ".";
            if (type === 'alpha-dot') return String.fromCharCode(96 + value) + ".";
            if (type === 'alpha-upper-dot') return String.fromCharCode(64 + value) + ".";
            if (type === 'roman-dot') return (numToRoman(value) || value) + ".";
            if (type === 'roman-lower-dot') return (numToRoman(value, true) || value) + ".";
            if (type === 'alpha-paren') return "(" + String.fromCharCode(96 + value) + ")";
            if (type === 'alpha-upper-paren') return "(" + String.fromCharCode(64 + value) + ")";
            if (type === 'roman-paren') return "(" + (numToRoman(value) || value) + ")";
            if (type === 'roman-lower-paren') return "(" + (numToRoman(value, true) || value) + ")";
            if (type === 'number-paren') return "(" + value + ")";
            return '-';
        }

        function shiftBulletMarker(marker, delta) {
            const currentIndex = BULLET_LEVELS.indexOf(marker);
            const startIndex = currentIndex === -1 ? 0 : currentIndex;
            const nextIndex = (startIndex + delta + BULLET_LEVELS.length) % BULLET_LEVELS.length;
            return BULLET_LEVELS[nextIndex];
        }

        function replaceLineMarker(line, info, indent, markerType, value) {
            const content = stripOutlinePrefix(line, info);
            return "\t".repeat(indent) + formatOutlineMarker(markerType, value, state.norm.separator) + " " + content;
        }

        function computeOutlineCounters(lines, counters = []) {
            lines.forEach(line => {
                const info = getSymbolInfo(line);
                if (!info) return;
                counters.length = info.indent + 1;
                counters[info.indent] = (counters[info.indent] || 0) + 1;
            });
            return counters;
        }

        function getOutlineCountersBefore(text, lineStart) {
            const before = text.substring(0, lineStart);
            if (!before) return [];
            return computeOutlineCounters(before.split('\n'), []);
        }

        function getSelectionIndent(lines) {
            const outlineIndents = lines
                .map(line => getSymbolInfo(line))
                .filter(Boolean)
                .map(info => info.indent);

            if (!outlineIndents.length) return null;
            return Math.min(...outlineIndents);
        }

        function expandRangeToIncludeChildren(text, lineStart, lineEnd) {
            const selectedLines = text.substring(lineStart, lineEnd).split('\n');
            const baseIndent = getSelectionIndent(selectedLines);
            if (baseIndent === null) return { lineStart, lineEnd };

            let nextStart = lineEnd === text.length ? text.length : lineEnd + 1;
            let expandedEnd = lineEnd;

            while (nextStart < text.length) {
                const nextEnd = getLineEndFromStart(text, nextStart);
                const nextLine = text.substring(nextStart, nextEnd);
                const info = getSymbolInfo(nextLine);
                const indent = info ? info.indent : 0;
                if (indent <= baseIndent) break;
                expandedEnd = nextEnd;
                nextStart = nextEnd + 1;
            }

            return { lineStart, lineEnd: expandedEnd };
        }

        function normalizeOutlineLines(lines, initialCounters = []) {
            const counters = [...initialCounters];
            return lines.map(line => {
                const info = getSymbolInfo(line);
                if (!info) return line;
                if (info.type === 'bullet') return replaceLineMarker(line, info, info.indent, 'bullet', info.value);

                counters.length = info.indent + 1;
                counters[info.indent] = (counters[info.indent] || 0) + 1;
                return replaceLineMarker(line, info, info.indent, getMarkerTypeForDepth(info.indent), counters[info.indent]);
            });
        }

        function shiftOutlineBlock(lines, delta) {
            const baseIndent = getSelectionIndent(lines);
            if (baseIndent === null) {
                return lines.map(line => delta > 0 ? "\t" + line : (line.startsWith('\t') ? line.substring(1) : line));
            }
            if (delta < 0 && baseIndent === 0) return lines;

            return lines.map(line => {
                const info = getSymbolInfo(line);
                if (!info) return delta > 0 ? "\t" + line : (line.startsWith('\t') ? line.substring(1) : line);

                const nextIndent = Math.max(0, info.indent + delta);
                if (info.type === 'bullet') return replaceLineMarker(line, info, nextIndent, 'bullet', shiftBulletMarker(info.value, delta > 0 ? 1 : -1));
                return replaceLineMarker(line, info, nextIndent, getMarkerTypeForDepth(nextIndent), 1);
            });
        }

        function transformSelectedLines(text, start, end, transformLine, transformLines) {
            const baseRange = getLineRange(text, start, end);
            const { lineStart, lineEnd } = expandRangeToIncludeChildren(text, baseRange.lineStart, baseRange.lineEnd);
            const block = text.substring(lineStart, lineEnd);
            const lines = block.split('\n');
            const countersBefore = getOutlineCountersBefore(text, lineStart);
            const transformedLines = transformLines ? transformLines(lines) : lines.map(transformLine);
            const nextLines = normalizeOutlineLines(transformedLines, countersBefore);
            const nextBlock = nextLines.join('\n');
            const isCollapsed = start === end;
            const isSingleLine = block.indexOf('\n') === -1 && nextBlock.indexOf('\n') === -1;
            const selectionOffsetStart = Math.max(0, start - lineStart);
            const selectionOffsetEnd = Math.max(0, end - lineStart);
            const nextSelectionStart = isCollapsed && isSingleLine ? Math.min(lineStart + nextBlock.length, lineStart + selectionOffsetStart + (nextBlock.length - block.length)) : lineStart;
            const nextSelectionEnd = isCollapsed && isSingleLine ? nextSelectionStart : lineStart + (isSingleLine ? Math.min(nextBlock.length, selectionOffsetEnd + (nextBlock.length - block.length)) : nextBlock.length);

            return {
                text: text.substring(0, lineStart) + nextBlock + text.substring(lineEnd),
                selectionStart: nextSelectionStart,
                selectionEnd: nextSelectionEnd
            };
        }

        function indentSelectedLines(text, start, end) {
            return transformSelectedLines(text, start, end, null, (lines) => shiftOutlineBlock(lines, 1));
        }

        function outdentSelectedLines(text, start, end) {
            return transformSelectedLines(text, start, end, null, (lines) => shiftOutlineBlock(lines, -1));
        }

        function continueOutlineItem(text, cursor) {
            const { lineStart, lineEnd } = getLineRange(text, cursor, cursor);
            const line = text.substring(lineStart, lineEnd);
            const info = getSymbolInfo(line);
            if (!info) return null;

            let marker;
            if (info.type === 'bullet') {
                marker = formatOutlineMarker('bullet', info.value, state.norm.separator);
            } else {
                const countersBefore = getOutlineCountersBefore(text, lineEnd + (lineEnd < text.length ? 1 : 0));
                const nextValue = (countersBefore[info.indent] || 0) + 1;
                marker = formatOutlineMarker(getMarkerTypeForDepth(info.indent), nextValue, state.norm.separator);
            }
            const nextLine = "\n" + "\t".repeat(info.indent) + marker + " ";
            const nextText = text.substring(0, cursor) + nextLine + text.substring(cursor);
            const nextCursor = cursor + nextLine.length;

            return { text: nextText, selectionStart: nextCursor, selectionEnd: nextCursor };
        }

        function normalizeSelection() {
            const tab = getActiveTab();
            const ta = getEditorTextarea(tab ? tab.id : '');
            if (!tab || !ta) return;
            const start = ta.selectionStart, end = ta.selectionEnd, fullText = ta.value;
            const baseRange = getLineRange(fullText, start, end);
            const { lineStart, lineEnd } = expandRangeToIncludeChildren(fullText, baseRange.lineStart, baseRange.lineEnd);
            const selection = fullText.substring(lineStart, lineEnd);
            const countersBefore = getOutlineCountersBefore(fullText, lineStart);
            const result = normalizeOutlineLines(selection.split('\n'), countersBefore).join('\n');

            if (selection !== result) {
                const oldScroll = ta.scrollTop;
                ta.value = fullText.substring(0, lineStart) + result + fullText.substring(lineEnd);
                ta.scrollTop = oldScroll;
                ta.selectionStart = lineStart;
                ta.selectionEnd = lineStart + result.length;
                updateContent(tab.id, ta.value, ta);
            }
        }

        function applyTheme() {
            const root = document.documentElement; const { accent, mode } = state.theme;
            root.style.setProperty('--accent-color', accent);
            document.body.classList.remove('theme-light', 'theme-dark', 'theme-matrix');
            if (mode !== 'default') document.body.classList.add('theme-' + mode);
            document.getElementById('hex-accent').value = accent.replace('#', '');
            document.getElementById('norm-separator').value = state.norm.separator;
            document.querySelectorAll('.outline-level-input').forEach((input, index) => {
                input.value = getOutlineStyleLabel(getOutlineLevels()[index] || DEFAULT_OUTLINE_LEVELS[index]);
            });
            document.querySelectorAll('.mode-btn').forEach(btn => {
                const isActive = btn.dataset.mode === mode;
                btn.style.backgroundColor = isActive ? accent : 'transparent';
                btn.style.color = isActive ? 'white' : 'inherit';
                btn.style.borderColor = isActive ? accent : 'var(--border-color)';
            });
            document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.getAttribute('data-color').toLowerCase() === accent.toLowerCase()));
            requestRender('full');
        }

        function flushSaveToStorage() {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(state.tabs));
            localStorage.setItem(STORAGE_KEY_ACTIVE, state.activeTabId);
            localStorage.setItem(STORAGE_KEY_THEME, JSON.stringify({theme: state.theme, norm: state.norm, multiViewIds: state.multiViewIds, multiViewMode: state.multiViewMode}));
            const status = document.getElementById('save-status');
            if (status) status.innerText = "Synced " + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        }

        function saveToStorage() {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                flushSaveToStorage();
            }, SAVE_DEBOUNCE_MS);
        }

        function addTab(title = 'untitled.txt', content = '') {
            const id = Date.now().toString() + Math.random();
            state.tabs.push({
                id,
                title,
                content,
                manuallyRenamed: title !== 'untitled.txt',
                showLineNumbers: true,
                showZebra: true,
                outlineModeActive: false,
                collapsedLines: [],
                manualSavedContent: content,
                manualSavedAt: Date.now()
            });
            state.activeTabId = id;
            saveToStorage();
            requestRender('full');
            focusEditorAtStart(id);
        }

        function closeTab(id) { 
            if (state.tabs.length > 1) { 
                state.tabs = state.tabs.filter(t => t.id !== id); state.multiViewIds = state.multiViewIds.filter(mid => mid !== id);
                if (state.activeTabId === id) state.activeTabId = state.tabs[0].id; 
                saveToStorage();
                requestRender('full');
            } 
        }

        function updateContent(id, content, textarea) {
            const t = getTabById(id); if (!t) return;
            if (t.content !== content) recordTabHistory(id);
            t.content = content;
            invalidateTabCaches(id);
            if (!t.manuallyRenamed) {
                t.title = deriveTitleFromText(getCachedLines(content, `${id}:title`)[0]);
                requestRender('tabs');
            }
            saveToStorage();
            if (id === state.activeTabId) refreshSearchResults({ preserveIndex: true });
            requestRender('toolbar');
        }

        function toggleSettings(open) {
            const menu = document.getElementById('settings-menu'), overlay = document.getElementById('settings-overlay');
            if (open) { menu.classList.add('open'); overlay.classList.remove('hidden'); setTimeout(() => { overlay.style.opacity = "1"; }, 10); }
            else { menu.classList.remove('open'); overlay.style.opacity = "0"; setTimeout(() => { overlay.classList.add('hidden'); }, 200); }
        }

        function init() {
            const savedTabs = localStorage.getItem(STORAGE_KEY_TABS), savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE), savedThemeData = localStorage.getItem(STORAGE_KEY_THEME);

            try {
                state.tabs = savedTabs ? hydrateTabs(JSON.parse(savedTabs)) : [createDefaultTab()];
            } catch {
                state.tabs = [createDefaultTab()];
            }

            state.activeTabId = getTabById(savedActiveId) ? savedActiveId : state.tabs[0].id;

            if (savedThemeData) {
                try {
                    const p = JSON.parse(savedThemeData);
                    state.theme = p.theme || state.theme;
                    state.norm = {
                        separator: p.norm?.separator || state.norm.separator,
                        levels: Array.isArray(p.norm?.levels) && p.norm.levels.length === 7 ? p.norm.levels : [...DEFAULT_OUTLINE_LEVELS]
                    };
                    state.multiViewIds = Array.isArray(p.multiViewIds) ? p.multiViewIds.filter(id => getTabById(id)).slice(0, 4) : [];
                    state.multiViewMode = p.multiViewMode || 'vert';
                } catch {
                    state.multiViewIds = [];
                    state.multiViewMode = 'vert';
                }
            }
            applyTheme(); setupListeners();
        }

        function setupListeners() {
            window.addEventListener('beforeunload', flushSaveToStorage);
            document.addEventListener('keydown', handleSelectedRangeDelete);
            document.addEventListener('keydown', handleSelectedRangeTab);
            document.addEventListener('keydown', handleUndoRedoShortcuts);
            document.addEventListener('keydown', handleManualSaveShortcut);
            document.addEventListener('keydown', handleFindShortcuts);
            document.addEventListener('copy', handleSelectedRangeCopy);
            document.addEventListener('cut', handleSelectedRangeCut);
            document.addEventListener('paste', handleSelectedRangePaste);
            document.addEventListener('keydown', (e) => updateHoveredLineDragReady(e.shiftKey));
            document.addEventListener('keyup', (e) => {
                if (e.key === 'Shift') updateHoveredLineDragReady(false);
            });
            document.addEventListener('mousemove', handlePendingLineDrag);
            document.addEventListener('mouseup', endDragSelection);
            document.getElementById('add-tab-btn').onclick = () => addTab();
            document.getElementById('duplicate-tab-btn').onclick = () => duplicateActiveTab();
            document.getElementById('import-btn').onclick = () => document.getElementById('file-input').click();
            document.getElementById('export-tab-btn').onclick = () => {
                const t = state.tabs.find(x => x.id === state.activeTabId);
                if (t) {
                    triggerDownload(t.title, t.content);
                    markManualSave(t.id);
                }
            };
            document.getElementById('undo-btn').onclick = () => restoreTabHistory(state.activeTabId, 'undo');
            document.getElementById('redo-btn').onclick = () => restoreTabHistory(state.activeTabId, 'redo');
            document.getElementById('open-find-btn').onclick = () => {
                if (state.search.open) closeFindBar();
                else openFindBar();
            };
            document.getElementById('manual-save-btn').onclick = () => markManualSave(state.activeTabId);
            document.getElementById('manual-save-all-btn').onclick = () => markManualSaveAll();
            document.getElementById('restore-save-btn').onclick = () => restoreLastManualSave(state.activeTabId);
            document.getElementById('export-all-btn').onclick = () => exportAll();
            document.getElementById('find-next-btn').onclick = () => goToSearchResult(state.search.currentIndex + 1);
            document.getElementById('find-input').oninput = (e) => {
                state.search.query = e.target.value;
                invalidateSearchCache();
                refreshSearchResults();
                requestRender('editor');
            };
            document.getElementById('find-input').onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    goToSearchResult(state.search.currentIndex + 1);
                }
            };
            document.getElementById('find-fuzzy-toggle').onchange = (e) => {
                state.search.fuzzy = e.target.checked;
                invalidateSearchCache();
                refreshSearchResults();
                requestRender('editor');
            };
            document.getElementById('file-input').onchange = (e) => { Array.from(e.target.files).forEach(file => { const r = new FileReader(); r.onload = (ev) => addTab(file.name, ev.target.result); r.readAsText(file); }); e.target.value = ''; };
            document.getElementById('open-settings-btn').onclick = () => toggleSettings(true);
            document.getElementById('close-settings-btn').onclick = () => toggleSettings(false);
            document.getElementById('settings-overlay').onclick = () => toggleSettings(false);
            document.getElementById('toggle-tab-orientation').onclick = () => mutateState(() => {
                state.theme.orientation = state.theme.orientation === 'horizontal' ? 'vertical' : 'horizontal';
            }, { render: 'full', save: true });
            document.getElementById('toggle-view-mode').onclick = () => mutateState(() => {
                const modes = ['vert', 'horiz', 'card'];
                state.multiViewMode = modes[(modes.indexOf(state.multiViewMode) + 1) % modes.length];
            }, { render: 'full', save: true });
            document.querySelectorAll('.mode-btn').forEach(btn => { btn.onclick = () => { state.theme.mode = btn.dataset.mode; applyTheme(); saveToStorage(); }; });
            document.getElementById('accent-swatches').onclick = (e) => { if (e.target.classList.contains('swatch')) { state.theme.accent = e.target.getAttribute('data-color'); applyTheme(); saveToStorage(); } };
            document.getElementById('hex-accent').oninput = (e) => { if (/^[0-9A-Fa-f]{6}$/.test(e.target.value)) { state.theme.accent = '#' + e.target.value; applyTheme(); saveToStorage(); } };
            document.getElementById('zip-export-toggle').onchange = (e) => mutateState(() => { state.theme.zipExport = e.target.checked; }, { save: true, render: 'toolbar' });
            document.getElementById('norm-separator').oninput = (e) => { state.norm.separator = e.target.value; applyTheme(); saveToStorage(); };
            document.querySelectorAll('.outline-level-input').forEach(input => {
                input.onchange = (e) => {
                    const index = Number(e.target.dataset.levelIndex);
                    const nextLevels = [...getOutlineLevels()];
                    nextLevels[index] = normalizeOutlineStyleInput(e.target.value, nextLevels[index] || DEFAULT_OUTLINE_LEVELS[index]);
                    state.norm.levels = nextLevels;
                    applyTheme();
                    saveToStorage();
                };
            });
            document.getElementById('reset-theme-btn').onclick = () => { state.theme = { accent: '#2563eb', mode: 'default', orientation: 'horizontal', zipExport: false }; state.norm = { separator: '.', levels: [...DEFAULT_OUTLINE_LEVELS] }; applyTheme(); saveToStorage(); };
            document.getElementById('toggle-line-numbers').onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.showLineNumbers = !t.showLineNumbers; }, { render: 'full', save: true });
            };
            document.getElementById('toggle-zebra').onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.showZebra = !t.showZebra; }, { render: 'editor', save: true });
            };
            document.getElementById('toggle-outline-mode').onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.outlineModeActive = !t.outlineModeActive; }, { render: 'editor', save: true });
            };
        }

        window.onload = init;



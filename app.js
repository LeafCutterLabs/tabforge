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
        const { createTabRecord, hydrateTabRecord, duplicateTabRecord } = window.TabForgeTabModel;
        const { getStorageKeys, safeParseJSON, normalizeThemePayload, serializeStatePayload } = window.TabForgePersistence;
        const { createTabState, duplicateTabState, closeTabState } = window.TabForgeCommands;

        let state = {
            tabs: [],
            activeTabId: '',
            multiViewIds: [],
            multiViewMode: 'vert',
            lastTabTime: 0,
            tempOutlineDisabled: false,
            activeLineIndex: 0,
            selectedLineRange: null,
            selectedLineSet: null,
            selectedLineAnchor: null,
            dragSelecting: null,
            dragMove: null,
            pendingLineDrag: null,
            pendingCaret: null,
            preserveSelectionOnFocus: false,
            hoveredLineKey: null,
            search: { open: false, query: '', replace: '', fuzzy: false, results: [], currentIndex: -1 },
            theme: { accent: '#2563eb', mode: 'default', orientation: 'horizontal', zipExport: false },
            norm: { separator: '.', levels: [...DEFAULT_OUTLINE_LEVELS] }
        };

        let draggedTabId = null;
        const historyByTab = {};
        const globalActionHistory = { undo: [], redo: [] };
        const typingHistoryByTab = {};
        const lineCache = new Map();
        const structureCache = new Map();
        const visibleStateCache = new Map();
        const searchResultsCache = new Map();
        const domRefs = {};
        let suppressHistory = false;
        let saveTimer = null;
        let renderFrame = null;
        let pendingRender = { layout: false, tabs: false, editor: false, toolbar: false, find: false };
        const TAB_RENAME_HOVER_MS = 800;
        const SAVE_DEBOUNCE_MS = 120;
        const MAX_CACHE_ENTRIES = 300;
        const TYPING_HISTORY_COALESCE_MS = 900;
        const DEBUG_INVARIANTS = false;

        const STORAGE_KEYS = getStorageKeys(55);
        const STORAGE_KEY_TABS = STORAGE_KEYS.tabs;
        const STORAGE_KEY_ACTIVE = STORAGE_KEYS.active;
        const STORAGE_KEY_THEME = STORAGE_KEYS.theme;
        const STORAGE_KEY_RECOVERY = STORAGE_KEYS.recovery;

        function setCachedValue(map, key, value) {
            if (map.has(key)) map.delete(key);
            map.set(key, value);
            if (map.size > MAX_CACHE_ENTRIES) {
                const oldestKey = map.keys().next().value;
                if (oldestKey !== undefined) map.delete(oldestKey);
            }
            return value;
        }

        function debugInvariant(message, details = null) {
            if (!DEBUG_INVARIANTS) return;
            console.warn(`[tabForge invariant] ${message}`, details ?? '');
        }

        function getCachePrefix(key) {
            return String(key).split('::', 1)[0];
        }

        function matchesTabCacheKey(key, tabId) {
            const prefix = getCachePrefix(key);
            return prefix === tabId || prefix.startsWith(`${tabId}:`);
        }

        function cacheDomRefs() {
            [
                'app-body',
                'tabs-container',
                'editor-container',
                'find-bar',
                'find-input',
                'replace-input',
                'find-fuzzy-toggle',
                'find-count',
                'find-other-tabs',
                'toggle-line-numbers',
                'toggle-zebra',
                'toggle-word-wrap',
                'toggle-outline-mode',
                'toggle-tab-orientation',
                'orient-icon',
                'status-filename',
                'stat-lines',
                'stat-words',
                'stat-chars',
                'stat-time',
                'toggle-view-mode',
                'view-mode-icon',
                'undo-btn',
                'redo-btn',
                'manual-save-btn',
                'manual-save-all-btn',
                'restore-save-btn',
                'save-status',
                'open-find-btn',
                'zip-export-toggle',
                'hex-accent',
                'norm-separator',
                'file-input',
                'add-tab-btn',
                'duplicate-tab-btn',
                'import-btn',
                'export-tab-btn',
                'export-all-btn',
                'find-next-btn',
                'replace-btn',
                'replace-all-btn',
                'print-btn',
                'print-line-numbers-toggle',
                'open-settings-btn',
                'close-settings-btn',
                'settings-overlay',
                'settings-menu',
                'toggle-view-mode',
                'reset-theme-btn',
                'accent-swatch-btn',
                'accent-color-picker',
                'toggle-hide-completed',
                'text-transform-group',
                'transform-upper-btn',
                'transform-lower-btn',
                'transform-sentence-btn',
                'transform-title-btn'
            ].forEach(id => {
                domRefs[id] = document.getElementById(id);
            });
            domRefs.outlineLevelInputs = Array.from(document.querySelectorAll('.outline-level-input'));
            domRefs.modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
        }

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
            const body = domRefs['app-body'];
            const tabs = domRefs['tabs-container'];
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
            validateStateIntegrity('flushRender');
            if (renderFrame) {
                cancelAnimationFrame(renderFrame);
                renderFrame = null;
            }
            const nextFlags = { ...flags };
            pendingRender = { layout: false, tabs: false, editor: false, toolbar: false, find: false };
            if (nextFlags.layout) applyLayoutClasses();
            if (nextFlags.editor || nextFlags.toolbar || nextFlags.find) {
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

        function makeTabId() {
            return Date.now().toString() + Math.random();
        }

        function createDefaultTab() {
            const content = '1. Welcome to tabForge\n3. Export single or all tabs\n2. Reorder your workspace\n\nCheck stats in the footer!';
            return createTabRecord({
                id: '1',
                title: 'tabForge.txt',
                content,
                manuallyRenamed: false
            });
        }

        function getTabById(id) {
            return state.tabs.find(tab => tab.id === id);
        }

        function getActiveTab() {
            return getTabById(state.activeTabId);
        }

        function normalizePersistedThemePayload(payload) {
            return normalizeThemePayload(payload, state.theme, state.norm, DEFAULT_OUTLINE_LEVELS);
        }

        function validateStateIntegrity(context = 'unknown') {
            if (!Array.isArray(state.tabs) || state.tabs.length === 0) {
                debugInvariant(`tabs missing during ${context}, restoring default tab`);
                state.tabs = [createDefaultTab()];
            }

            state.tabs = state.tabs.filter(tab => tab && typeof tab.id === 'string');
            if (!state.tabs.length) state.tabs = [createDefaultTab()];

            if (!getTabById(state.activeTabId)) {
                debugInvariant(`activeTabId invalid during ${context}, resetting`);
                state.activeTabId = state.tabs[0].id;
            }

            state.multiViewIds = (Array.isArray(state.multiViewIds) ? state.multiViewIds : [])
                .filter(id => getTabById(id))
                .slice(0, 4);

            const activeTab = getActiveTab();
            const activeLines = getTabLines(activeTab);
            state.activeLineIndex = Math.max(0, Math.min(state.activeLineIndex || 0, Math.max(0, activeLines.length - 1)));

            if (state.selectedLineRange) {
                const selectedTab = getTabById(state.selectedLineRange.tabId);
                if (!selectedTab) {
                    debugInvariant(`selectedLineRange tab missing during ${context}, clearing`);
                    state.selectedLineRange = null;
                } else {
                    const selectedLines = getTabLines(selectedTab);
                    const maxIndex = Math.max(0, selectedLines.length - 1);
                    state.selectedLineRange = {
                        tabId: state.selectedLineRange.tabId,
                        start: Math.max(0, Math.min(state.selectedLineRange.start, maxIndex)),
                        end: Math.max(0, Math.min(state.selectedLineRange.end, maxIndex))
                    };
                    if (state.selectedLineRange.start > state.selectedLineRange.end) {
                        [state.selectedLineRange.start, state.selectedLineRange.end] = [state.selectedLineRange.end, state.selectedLineRange.start];
                    }
                }
            }

            if (state.selectedLineSet) {
                const selectedTab = getTabById(state.selectedLineSet.tabId);
                if (!selectedTab) {
                    debugInvariant(`selectedLineSet tab missing during ${context}, clearing`);
                    state.selectedLineSet = null;
                } else {
                    const maxIndex = Math.max(0, getTabLines(selectedTab).length - 1);
                    const nextIndices = [...new Set((state.selectedLineSet.indices || [])
                        .filter(Number.isInteger)
                        .map(index => Math.max(0, Math.min(index, maxIndex))))].sort((a, b) => a - b);
                    state.selectedLineSet = nextIndices.length ? { tabId: selectedTab.id, indices: nextIndices } : null;
                }
            }

            if (state.selectedLineAnchor && (!getTabById(state.selectedLineAnchor.tabId) || !Number.isInteger(state.selectedLineAnchor.index))) {
                state.selectedLineAnchor = null;
            }
        }

        function serializePersistenceState() {
            validateStateIntegrity('serializePersistenceState');
            return serializeStatePayload(state);
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
            const nextState = duplicateTabState({
                tabs: state.tabs,
                activeTabId: state.activeTabId,
                createId: makeTabId,
                buildTitle: appendNewToTitle
            });
            if (!nextState) return;
            state.tabs = nextState.tabs;
            state.activeTabId = nextState.activeTabId;
            saveToStorage();
            requestRender('full');
        }

        function getOutlineLevels() {
            return Array.isArray(state.norm.levels) && state.norm.levels.length ? state.norm.levels : [...DEFAULT_OUTLINE_LEVELS];
        }

        function getOutlineStyleLabel(style) {
            return OUTLINE_STYLE_LABELS[style] || style || '1.';
        }

        function normalizeOutlineStyleInput(value, fallback) {
            const trimmed = value.trim();
            if (!trimmed) return fallback;
            const normalized = trimmed.toLowerCase();
            return OUTLINE_LABEL_TO_STYLE[normalized] || trimmed;
        }

        function parseOutlineStyleTemplate(style) {
            const sample = String(style || '').trim();
            if (!sample) return null;

            const parenMatch = sample.match(/^([^A-Za-z0-9]*)(\(?)([A-Za-z0-9]+)(\)?)([^A-Za-z0-9]*)$/);
            if (!parenMatch) return null;

            const prefix = `${parenMatch[1] || ''}${parenMatch[2] || ''}`;
            const token = parenMatch[3] || '';
            const suffix = `${parenMatch[4] || ''}${parenMatch[5] || ''}`;

            let kind = null;
            let caseMode = 'lower';

            if (/^\d+$/.test(token)) {
                kind = 'number';
            } else if (/^[IVXLCDM]+$/.test(token)) {
                kind = 'roman';
                caseMode = 'upper';
            } else if (/^[ivxlcdm]+$/.test(token) && token.length > 1) {
                kind = 'roman';
                caseMode = 'lower';
            } else if (token === 'I') {
                kind = 'roman';
                caseMode = 'upper';
            } else if (token === 'i') {
                kind = 'roman';
                caseMode = 'lower';
            } else if (/^[A-Z]$/.test(token)) {
                kind = 'alpha';
                caseMode = 'upper';
            } else if (/^[a-z]$/.test(token)) {
                kind = 'alpha';
                caseMode = 'lower';
            }

            if (!kind) return null;
            return { kind, caseMode, prefix, suffix };
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

        function getSelectionOffsets(el) {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return null;
            const range = selection.getRangeAt(0);
            if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;

            const startRange = range.cloneRange();
            startRange.selectNodeContents(el);
            startRange.setEnd(range.startContainer, range.startOffset);

            const endRange = range.cloneRange();
            endRange.selectNodeContents(el);
            endRange.setEnd(range.endContainer, range.endOffset);

            return {
                start: startRange.toString().length,
                end: endRange.toString().length,
                collapsed: range.collapsed
            };
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
            if (state.selectedLineSet && state.selectedLineSet.tabId === tabId && state.selectedLineSet.indices.length) {
                const sorted = [...state.selectedLineSet.indices].sort((a, b) => a - b);
                return {
                    start: sorted[0],
                    end: sorted[sorted.length - 1],
                    indices: sorted,
                    isMultiLine: sorted.length > 1,
                    hasSelection: true,
                    isSparse: sorted.length > 1 && !sorted.every((index, idx) => idx === 0 || index === sorted[idx - 1] + 1)
                };
            }
            if (state.selectedLineRange && state.selectedLineRange.tabId === tabId) {
                return {
                    start: state.selectedLineRange.start,
                    end: state.selectedLineRange.end,
                    indices: Array.from({ length: state.selectedLineRange.end - state.selectedLineRange.start + 1 }, (_, offset) => state.selectedLineRange.start + offset),
                    isMultiLine: state.selectedLineRange.start !== state.selectedLineRange.end,
                    hasSelection: true,
                    isSparse: false
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
                indices: Array.from({ length: Math.abs(end - start) + 1 }, (_, offset) => Math.min(start, end) + offset),
                isMultiLine: start !== end,
                hasSelection: !selection.isCollapsed,
                isSparse: false
            };
        }

        function getSelectedLineIndices(tabId) {
            const range = getSelectedLineRange(tabId);
            return range?.indices ? [...range.indices] : [];
        }

        function isLineIndexSelected(tabId, lineIndex) {
            return getSelectedLineIndices(tabId).includes(lineIndex);
        }

        function setSelectedLineIndices(tabId, indices) {
            const sorted = [...new Set(indices.filter(Number.isInteger))].sort((a, b) => a - b);
            state.selectedLineRange = null;
            state.selectedLineSet = sorted.length ? { tabId, indices: sorted } : null;
            if (sorted.length) {
                state.selectedLineAnchor = { tabId, index: sorted[sorted.length - 1] };
            }
        }

        function setSingleLineSelection(tabId, lineIndex) {
            state.selectedLineSet = null;
            state.selectedLineRange = { tabId, start: lineIndex, end: lineIndex };
            state.selectedLineAnchor = { tabId, index: lineIndex };
        }

        function toggleSelectedLineIndex(tabId, lineIndex) {
            const existing = state.selectedLineSet && state.selectedLineSet.tabId === tabId
                ? [...state.selectedLineSet.indices]
                : getSelectedLineIndices(tabId);
            const next = existing.includes(lineIndex)
                ? existing.filter(index => index !== lineIndex)
                : [...existing, lineIndex];
            setSelectedLineIndices(tabId, next);
        }

        function extendLineSelectionTo(tabId, lineIndex) {
            const anchor = state.selectedLineAnchor && state.selectedLineAnchor.tabId === tabId
                ? state.selectedLineAnchor.index
                : lineIndex;
            state.selectedLineSet = null;
            setSelectedLineRange(tabId, anchor, lineIndex);
            state.selectedLineAnchor = { tabId, index: anchor };
        }

        function clearSelectedLineSelection() {
            state.selectedLineRange = null;
            state.selectedLineSet = null;
            state.selectedLineAnchor = null;
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
            return getTabStructure(tab).lines;
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

        function hexToRgb(hex) {
            const normalized = String(hex || '').replace('#', '').trim();
            if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
            return {
                r: parseInt(normalized.slice(0, 2), 16),
                g: parseInt(normalized.slice(2, 4), 16),
                b: parseInt(normalized.slice(4, 6), 16)
            };
        }

        function blendHighlightColors(colors, alpha = 0.18) {
            const rgbs = colors.map(hexToRgb).filter(Boolean);
            if (!rgbs.length) return null;
            const total = rgbs.reduce((acc, color) => ({
                r: acc.r + color.r,
                g: acc.g + color.g,
                b: acc.b + color.b
            }), { r: 0, g: 0, b: 0 });
            const count = rgbs.length;
            return `rgba(${Math.round(total.r / count)}, ${Math.round(total.g / count)}, ${Math.round(total.b / count)}, ${alpha})`;
        }

        function getAttentionFlags(rawLine) {
            const flags = [];
            if (rawLine.includes('!!')) flags.push({ type: 'urgent', color: '#ef4444' });
            if (rawLine.includes('??')) flags.push({ type: 'question', color: '#f59e0b' });
            if (rawLine.includes('**')) flags.push({ type: 'important', color: '#8b5cf6' });
            if (rawLine.includes('--')) flags.push({ type: 'defer', color: '#0ea5e9' });
            if (/\bDONE\b/.test(rawLine)) flags.push({ type: 'done', color: '#22c55e' });
            if (/@[A-Za-z0-9_.-]+/.test(rawLine)) flags.push({ type: 'mention', color: '#0ea5e9' });
            if (/#[A-Za-z0-9_.-]+/.test(rawLine)) flags.push({ type: 'tag', color: '#22c55e' });
            return flags;
        }

        function hasBlockingAttention(rawLine) {
            return getAttentionFlags(rawLine).length > 0;
        }

        function buildRowHighlight(flags, accentColor = state.theme.accent) {
            if (!flags.length) return null;
            const colors = flags.map(flag => flag.color);
            const background = blendHighlightColors(colors, 0.18);
            return {
                background,
                accent: colors[0] || accentColor
            };
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
                JSON.stringify(tab?.collapsedLines || []),
                tab?.hideCompletedLines ? 'hide-completed' : 'show-completed',
                state.theme.accent || ''
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
                if (matchesTabCacheKey(key, tabId)) lineCache.delete(key);
            }
            for (const key of structureCache.keys()) {
                if (matchesTabCacheKey(key, tabId)) structureCache.delete(key);
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
            return setCachedValue(lineCache, key, lines);
        }

        function getCachedStructure(content = '', cacheKey = 'global') {
            const key = `${cacheKey}::${content}`;
            if (structureCache.has(key)) return structureCache.get(key);

            const lines = getCachedLines(content, cacheKey);
            const depths = lines.map(getLineDepth);
            const subtreeEnds = Array(lines.length).fill(0);
            const ancestorStack = [];

            for (let index = 0; index < lines.length; index++) {
                const depth = depths[index];
                while (ancestorStack.length && depths[ancestorStack[ancestorStack.length - 1]] >= depth) {
                    subtreeEnds[ancestorStack.pop()] = index - 1;
                }
                ancestorStack.push(index);
            }

            while (ancestorStack.length) {
                const index = ancestorStack.pop();
                subtreeEnds[index] = lines.length - 1;
            }

            const descendantCounts = subtreeEnds.map((endIndex, index) => Math.max(0, endIndex - index));
            return setCachedValue(structureCache, key, { lines, depths, subtreeEnds, descendantCounts });
        }

        function getTabStructure(tab) {
            if (!tab) return getCachedStructure('', 'tab');
            return getCachedStructure(tab.content || '', tab.id || 'tab');
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

            return setCachedValue(searchResultsCache, cacheKey, results);
        }

        function countMatchesInOtherTabs() {
            const activeTabId = state.activeTabId;
            return state.tabs
                .filter(tab => tab.id !== activeTabId)
                .reduce((total, tab) => total + buildSearchResults(tab).length, 0);
        }

        function syncFindBarUi() {
            const findBar = domRefs['find-bar'];
            const input = domRefs['find-input'];
            const replaceInput = domRefs['replace-input'];
            const fuzzy = domRefs['find-fuzzy-toggle'];
            const count = domRefs['find-count'];
            const otherTabs = domRefs['find-other-tabs'];
            const openFindBtn = domRefs['open-find-btn'];
            const replaceBtn = domRefs['replace-btn'];
            const replaceAllBtn = domRefs['replace-all-btn'];
            if (!findBar || !input || !replaceInput || !fuzzy || !count || !otherTabs || !openFindBtn || !replaceBtn || !replaceAllBtn) return;
            findBar.classList.toggle('hidden', !state.search.open);
            findBar.classList.toggle('flex', state.search.open);
            openFindBtn.classList.toggle('btn-active', state.search.open);
            input.value = state.search.query;
            replaceInput.value = state.search.replace;
            fuzzy.checked = state.search.fuzzy;
            fuzzy.disabled = state.search.query.trim().length < 3;
            fuzzy.parentElement.style.opacity = fuzzy.disabled ? '0.5' : '1';
            const canReplace = !state.search.fuzzy && Boolean(state.search.query.trim()) && state.search.currentIndex !== -1;
            replaceBtn.disabled = !canReplace;
            replaceAllBtn.disabled = !(!state.search.fuzzy && Boolean(state.search.query.trim()) && state.search.results.length);
            replaceBtn.style.opacity = replaceBtn.disabled ? '0.45' : '1';
            replaceAllBtn.style.opacity = replaceAllBtn.disabled ? '0.45' : '1';
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
            const structure = getTabStructure(tab);
            const ancestorsToOpen = [];
            for (const collapsedIndex of tab.collapsedLines) {
                if (collapsedIndex >= lineIndex) continue;
                const endIndex = structure.subtreeEnds[collapsedIndex] ?? collapsedIndex;
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
            requestRender('editor', { immediate: true });
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
                const input = domRefs['find-input'];
                if (!input) return;
                input.focus();
                input.select();
            });
        }

        function closeFindBar() {
            state.search.open = false;
            state.search.query = '';
            state.search.replace = '';
            state.search.fuzzy = false;
            state.search.results = [];
            state.search.currentIndex = -1;
            invalidateSearchCache();
            syncFindBarUi();
            requestRender('editor');
        }

        function replaceCurrentSearchResult() {
            const tab = getActiveTab();
            if (!tab || state.search.fuzzy || state.search.currentIndex === -1) return;
            const result = state.search.results[state.search.currentIndex];
            if (!result) return;
            const currentLines = [...getTabLines(tab)];
            const rawLine = currentLines[result.lineIndex];
            const leadingTabs = (rawLine.match(/^\t*/) || [''])[0];
            const rawStart = leadingTabs.length + result.start;
            const rawEnd = leadingTabs.length + result.end;
            currentLines[result.lineIndex] = rawLine.slice(0, rawStart) + state.search.replace + rawLine.slice(rawEnd);
            const nextIndex = state.search.currentIndex;
            updateTabLines(tab.id, currentLines, result.lineIndex, result.start + state.search.replace.length);
            requestAnimationFrame(() => {
                refreshSearchResults();
                if (state.search.results.length) goToSearchResult(Math.min(nextIndex, state.search.results.length - 1));
            });
        }

        function replaceAllSearchResults() {
            const tab = getActiveTab();
            if (!tab || state.search.fuzzy || !state.search.results.length) return;
            const currentLines = [...getTabLines(tab)];
            const groupedByLine = new Map();
            state.search.results.forEach(result => {
                if (!groupedByLine.has(result.lineIndex)) groupedByLine.set(result.lineIndex, []);
                groupedByLine.get(result.lineIndex).push(result);
            });

            [...groupedByLine.entries()].forEach(([lineIndex, results]) => {
                const rawLine = currentLines[lineIndex];
                const leadingTabs = (rawLine.match(/^\t*/) || [''])[0];
                let nextLine = rawLine;
                [...results].sort((a, b) => b.start - a.start).forEach(result => {
                    const rawStart = leadingTabs.length + result.start;
                    const rawEnd = leadingTabs.length + result.end;
                    nextLine = nextLine.slice(0, rawStart) + state.search.replace + nextLine.slice(rawEnd);
                });
                currentLines[lineIndex] = nextLine;
            });

            const firstLineIndex = state.search.results[0].lineIndex;
            updateTabLines(tab.id, currentLines, firstLineIndex, 0);
            requestAnimationFrame(() => refreshSearchResults());
        }

        function markManualSave(tabId = state.activeTabId) {
            const tab = getTabById(tabId);
            if (!tab) return;
            tab.manualSavedContent = tab.content;
            tab.manualSavedAt = Date.now();
            invalidateTabCaches(tabId);
            saveToStorage();
            requestRender({ layout: false, tabs: true, editor: true, toolbar: true, find: false });
        }

        function markManualSaveAll() {
            const now = Date.now();
            state.tabs.forEach(tab => {
                tab.manualSavedContent = tab.content;
                tab.manualSavedAt = now;
                invalidateTabCaches(tab.id);
            });
            saveToStorage();
            requestRender({ layout: false, tabs: true, editor: true, toolbar: true, find: false });
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

        function recordGlobalAction(action) {
            if (!action || suppressHistory) return;
            globalActionHistory.undo.push(action);
            if (globalActionHistory.undo.length > 200) globalActionHistory.undo.shift();
            globalActionHistory.redo = [];
        }

        function canUndo() {
            return globalActionHistory.undo.length > 0;
        }

        function canRedo() {
            return globalActionHistory.redo.length > 0;
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

        function recordTabHistory(tabId, snapshot = snapshotTabState(tabId), options = {}) {
            if (suppressHistory || !snapshot) return;
            const history = ensureTabHistory(tabId);
            const last = history.undo[history.undo.length - 1];
            if (sameTabSnapshot(last, snapshot)) return;
            const now = Date.now();
            const typingState = typingHistoryByTab[tabId];
            if (options.coalesceTyping && typingState && (now - typingState.at) <= TYPING_HISTORY_COALESCE_MS) {
                history.redo = [];
                globalActionHistory.redo = [];
                typingState.at = now;
                return;
            }
            history.undo.push(snapshot);
            if (history.undo.length > 100) history.undo.shift();
            history.redo = [];
            recordGlobalAction({ type: 'tab-edit', tabId });
            if (options.coalesceTyping) typingHistoryByTab[tabId] = { at: now };
            else delete typingHistoryByTab[tabId];
        }

        function restoreTabHistory(tabId, direction, options = {}) {
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
            saveToStorage();
            requestRender('editor', { immediate: true });
            suppressHistory = false;

            requestAnimationFrame(() => {
                const line = getLineEditor(tabId, state.activeLineIndex);
                if (!line) return;
                line.focus({ preventScroll: true });
                placeCaret(line, line.textContent.length);
            });

            if (!options.fromGlobal) {
                const action = { type: 'tab-edit', tabId };
                if (direction === 'undo') globalActionHistory.redo.push(action);
                else globalActionHistory.undo.push(action);
            }
        }

        function restoreClosedTab(action) {
            if (!action?.tabSnapshot) return;
            const exists = getTabById(action.tabSnapshot.id);
            if (exists) return;
            const insertIndex = Math.max(0, Math.min(action.index, state.tabs.length));
            state.tabs.splice(insertIndex, 0, {
                ...action.tabSnapshot,
                collapsedLines: [...(action.tabSnapshot.collapsedLines || [])]
            });
            state.multiViewIds = Array.isArray(action.multiViewIdsBefore)
                ? action.multiViewIdsBefore.filter(id => getTabById(id))
                : state.multiViewIds;
            state.activeTabId = action.activeTabIdBefore && getTabById(action.activeTabIdBefore)
                ? action.activeTabIdBefore
                : action.tabSnapshot.id;
            saveToStorage();
            requestRender('full', { immediate: true });
        }

        function recloseTabFromAction(action) {
            if (!action?.tabSnapshot) return;
            const tabExists = getTabById(action.tabSnapshot.id);
            if (!tabExists || state.tabs.length <= 1) return;
            state.tabs = state.tabs.filter(t => t.id !== action.tabSnapshot.id);
            state.multiViewIds = state.multiViewIds.filter(id => id !== action.tabSnapshot.id);
            if (state.activeTabId === action.tabSnapshot.id) {
                state.activeTabId = state.tabs[Math.max(0, Math.min(action.index, state.tabs.length - 1))]?.id || state.tabs[0].id;
            }
            saveToStorage();
            requestRender('full', { immediate: true });
        }

        function performUndo() {
            const action = globalActionHistory.undo.pop();
            if (!action) return;
            if (action.type === 'close-tab') {
                restoreClosedTab(action);
                globalActionHistory.redo.push(action);
                return;
            }
            restoreTabHistory(action.tabId, 'undo', { fromGlobal: true });
            globalActionHistory.redo.push(action);
        }

        function performRedo() {
            const action = globalActionHistory.redo.pop();
            if (!action) return;
            if (action.type === 'close-tab') {
                recloseTabFromAction(action);
                globalActionHistory.undo.push(action);
                return;
            }
            restoreTabHistory(action.tabId, 'redo', { fromGlobal: true });
            globalActionHistory.undo.push(action);
        }

        function getVisibleLineState(tab) {
            const cacheKey = getVisibleStateCacheKey(tab);
            if (visibleStateCache.has(cacheKey)) return visibleStateCache.get(cacheKey);
            const structure = getTabStructure(tab);
            const { lines, depths, descendantCounts } = structure;
            const collapsed = getCollapsedLineSet(tab);
            const visible = [];
            let hiddenDepth = null;
            let followsCollapsedGap = false;

            for (let i = 0; i < lines.length; i++) {
                const depth = depths[i];
                const attentionFlags = getAttentionFlags(lines[i]);
                const isDone = attentionFlags.some(flag => flag.type === 'done');
                if (tab.hideCompletedLines && isDone) continue;
                if (hiddenDepth !== null && depth > hiddenDepth && !hasBlockingAttention(lines[i])) continue;
                if (hiddenDepth !== null && depth <= hiddenDepth) {
                    hiddenDepth = null;
                    followsCollapsedGap = true;
                }

                const descendantCount = descendantCounts[i];
                const isCollapsed = collapsed.has(i) && descendantCount >= 3;
                const rowFlags = [...attentionFlags];
                if (isCollapsed) rowFlags.push({ type: 'collapsed-parent', color: state.theme.accent });
                if (followsCollapsedGap) rowFlags.push({ type: 'collapsed-gap', color: state.theme.accent });
                visible.push({
                    index: i,
                    raw: lines[i],
                    depth,
                    text: getDisplayText(lines[i]),
                    descendantCount,
                    isCollapsed,
                    showToggle: descendantCount >= 3,
                    attentionFlags,
                    rowHighlight: buildRowHighlight(rowFlags),
                    followsCollapsedGap
                });

                followsCollapsedGap = false;
                if (isCollapsed) hiddenDepth = depth;
            }

            const result = { lines, visible };
            return setCachedValue(visibleStateCache, cacheKey, result);
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
            requestRender('editor', { immediate: true });
            requestAnimationFrame(() => {
                const line = getLineEditor(tabId, state.activeLineIndex);
                if (!line) return;
                line.focus({ preventScroll: true });
                line.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
            requestRender('editor', { immediate: true });
        }

        function setSelectedLineRange(tabId, start, end) {
            state.selectedLineSet = null;
            state.selectedLineRange = {
                tabId,
                start: Math.min(start, end),
                end: Math.max(start, end)
            };
            state.selectedLineAnchor = { tabId, index: start };
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
                clearSelectedLineSelection();
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
            const selectedRange = getSelectedLineRange(tabId);
            if (selectedRange && !selectedRange.isSparse && lineIndex >= selectedRange.start && lineIndex <= selectedRange.end) {
                return { start: selectedRange.start, end: selectedRange.end };
            }
            const tab = getTabById(tabId);
            const structure = getTabStructure(tab);
            return { start: lineIndex, end: structure.subtreeEnds[lineIndex] ?? lineIndex };
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
            clearSelectedLineSelection();
            requestRender('editor', { immediate: true });
        }

        function updateLineDragMoveTarget(tabId, hoverIndex, position) {
            if (!state.dragMove || state.dragMove.tabId !== tabId) return;
            state.dragMove.hoverIndex = hoverIndex;
            state.dragMove.position = position;
            state.dragMove.targetIndex = position === 'before' ? hoverIndex : hoverIndex + 1;
            requestRender('editor', { immediate: true });
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
                requestRender('editor', { immediate: true });
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
            const block = lines.slice(startIndex, endIndex + 1);
            const shiftedBlock = shiftOutlineBlock(block, delta);
            const nextLines = [...lines];
            nextLines.splice(startIndex, block.length, ...shiftedBlock);
            return shouldNormalize ? normalizeOutlineLines(nextLines, []) : nextLines;
        }

        function handleSelectedRangeTab(e) {
            if (e.key !== 'Tab') return;
            const tab = getSelectedRangeTab();
            if (!tab) return;
            e.preventDefault();
            const currentLines = getTabLines(tab);
            const indices = getSelectedLineIndices(tab.id);
            if (!indices.length) return;
            let nextLines = [...currentLines];
            const segments = [];
            let segmentStart = indices[0];
            let previous = indices[0];
            for (let i = 1; i < indices.length; i++) {
                if (indices[i] !== previous + 1) {
                    segments.push([segmentStart, previous]);
                    segmentStart = indices[i];
                }
                previous = indices[i];
            }
            segments.push([segmentStart, previous]);
            [...segments].reverse().forEach(([start, end]) => {
                nextLines = tab.outlineModeActive && !state.tempOutlineDisabled
                    ? shiftOutlineRange(nextLines, start, end, e.shiftKey ? -1 : 1, true)
                    : shiftLineRange(nextLines, start, end, e.shiftKey ? -1 : 1);
            });
            const focusLine = indices[0];
            clearSelectedLineSelection();
            updateTabLines(tab.id, nextLines, focusLine, 0);
        }

        function handleSelectedRangeDelete(e) {
            if (!getSelectedRangeTab()) return;
            if (e.key !== 'Backspace' && e.key !== 'Delete') return;
            e.preventDefault();
            deleteSelectedRangeLines();
        }

        function handleUndoRedoShortcuts(e) {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                performUndo();
                return;
            }
            if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
                e.preventDefault();
                performRedo();
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
            if (isMod && e.key.toLowerCase() === 'h') {
                e.preventDefault();
                openFindBar();
                requestAnimationFrame(() => {
                    const replaceInput = domRefs['replace-input'];
                    if (!replaceInput) return;
                    replaceInput.focus();
                    replaceInput.select();
                });
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
            const tabId = state.selectedLineSet?.tabId || state.selectedLineRange?.tabId;
            return tabId ? getTabById(tabId) : null;
        }

        function normalizeClipboardText(text) {
            return (text || '').replace(/\r\n?/g, '\n');
        }

        function getSelectedRangeLines(tab) {
            if (!tab) return [];
            const lines = getTabLines(tab);
            return getSelectedLineIndices(tab.id).map(index => lines[index]).filter(line => line !== undefined);
        }

        function deleteSelectedRangeLines() {
            const tab = getSelectedRangeTab();
            if (!tab) return;
            const currentLines = getTabLines(tab);
            const indices = getSelectedLineIndices(tab.id);
            if (!indices.length) return;
            const firstIndex = indices[0];
            const indexSet = new Set(indices);
            const remainingLines = currentLines.filter((_, index) => !indexSet.has(index));
            const nextLines = remainingLines.length ? remainingLines : [''];
            const focusLine = Math.max(0, Math.min(firstIndex, nextLines.length - 1));
            clearSelectedLineSelection();
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
            const indices = getSelectedLineIndices(tab.id);
            if (!indices.length) return;
            const start = indices[0];
            const indexSet = new Set(indices);
            const incomingLines = pasted.split('\n');
            const nextLines = currentLines.filter((_, index) => !indexSet.has(index));
            nextLines.splice(start, 0, ...incomingLines);
            clearSelectedLineSelection();
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
                .map((tab, index) => hydrateTabRecord(tab, String(Date.now() + index)));

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
            const container = domRefs['tabs-container'];
            if (!container) return;
            container.innerHTML = '';
            state.tabs.forEach((tab) => {
                const active = state.activeTabId === tab.id;
                const mvIndex = state.multiViewIds.indexOf(tab.id);
                const isSelected = mvIndex !== -1;
                const isDirty = isTabDirty(tab);
                const mvStatusClass = isDirty ? 'mv-dirty' : 'mv-saved';
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
                    <button class="mv-toggle ${mvStatusClass} mr-2 w-4 h-4 flex items-center justify-center rounded border transition-colors text-current ${isSelected ? 'font-bold text-[10px]' : 'opacity-75 hover:opacity-100'}">
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

        function setViewModeIcon(mode) {
            const icon = domRefs['view-mode-icon'];
            if (!icon) return;
            if (mode === 'horiz') {
                icon.innerHTML = `
                    <rect x="5" y="4" width="14" height="7" rx="1"></rect>
                    <rect x="5" y="13" width="14" height="7" rx="1"></rect>
                `;
                return;
            }
            if (mode === 'card') {
                icon.innerHTML = `
                    <rect x="4" y="4" width="7" height="7" rx="1"></rect>
                    <rect x="13" y="4" width="7" height="7" rx="1"></rect>
                    <rect x="4" y="13" width="7" height="7" rx="1"></rect>
                    <rect x="13" y="13" width="7" height="7" rx="1"></rect>
                `;
                return;
            }
            icon.innerHTML = `
                <rect x="4" y="5" width="7" height="14" rx="1"></rect>
                <rect x="13" y="5" width="7" height="14" rx="1"></rect>
            `;
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
            wrap.dataset.editorTab = tab.id;
            if (tab.showWordWrap) wrap.classList.add('word-wrap-enabled');
            const root = document.createElement('div');
            root.className = "outline-root min-h-full " + (tab.showZebra && !tab.showWordWrap ? 'zebra-mode' : '');
            const { lines, visible } = getVisibleLineState(tab);
            const savedLines = getManualSavedLines(tab);

            visible.forEach((node, visibleIndex) => {
                const row = document.createElement('div');
                row.className = "outline-row" + (node.isCollapsed ? " collapsed-parent" : "");
                if (tab.showZebra && tab.showWordWrap && visibleIndex % 2 === 1) row.classList.add('zebra-row-alt');
                row.dataset.rowIndex = String(node.index);
                row.dataset.tabId = tab.id;
                const isRowSelected = isLineIndexSelected(tab.id, node.index);
                if (isRowSelected) row.classList.add('row-selected');
                if (state.dragMove && state.dragMove.tabId === tab.id && node.index >= state.dragMove.start && node.index <= state.dragMove.end) {
                    row.classList.add('drag-source');
                }
                if (node.rowHighlight) {
                    row.classList.add('has-row-highlight');
                    row.style.setProperty('--row-highlight-bg', node.rowHighlight.background);
                    row.style.setProperty('--row-highlight-accent', node.rowHighlight.accent);
                }
                if (node.attentionFlags.some(flag => flag.type === 'question')) row.classList.add('attention-question');
                if (node.attentionFlags.some(flag => flag.type === 'urgent')) row.classList.add('attention-urgent');
                if (node.isCollapsed) row.classList.add('collapsed-parent-highlight');
                if (node.followsCollapsedGap) row.classList.add('after-collapsed-gap');
                if ((lines[node.index] || '') !== (savedLines[node.index] || '')) row.classList.add('revision-changed');
                if (state.dragMove && state.dragMove.tabId === tab.id && state.dragMove.hoverIndex === node.index) {
                    row.classList.add(state.dragMove.position === 'before' ? 'drop-before' : 'drop-after');
                }

                if (tab.showLineNumbers) {
                    const gutter = document.createElement('div');
                    gutter.className = 'outline-gutter line-selectable';
                    if (node.showToggle) {
                        const toggle = document.createElement('span');
                        toggle.className = 'outline-toggle';
                        toggle.textContent = node.isCollapsed ? '+' : '-';
                        toggle.onmousedown = (e) => e.stopPropagation();
                        toggle.onclick = (e) => {
                            e.stopPropagation();
                            toggleCollapsedLine(tab.id, node.index);
                        };
                        gutter.appendChild(toggle);
                    }
                    const label = document.createElement('span');
                    label.textContent = String(node.index + 1);
                    gutter.appendChild(label);
                    gutter.onmousedown = (e) => {
                        e.stopPropagation();
                        state.activeTabId = tab.id;
                        state.activeLineIndex = node.index;
                        if (e.ctrlKey || e.metaKey) {
                            toggleSelectedLineIndex(tab.id, node.index);
                        } else if (e.shiftKey) {
                            extendLineSelectionTo(tab.id, node.index);
                        } else {
                            setSingleLineSelection(tab.id, node.index);
                        }
                        window.getSelection()?.removeAllRanges();
                        requestRender('editor', { immediate: true });
                    };
                    row.appendChild(gutter);
                }

                const line = document.createElement('div');
                line.contentEditable = "true";
                line.spellcheck = true;
                line.dataset.tabLine = `${tab.id}:${node.index}`;
                line.dataset.lineIndex = String(node.index);
                line.className = "outline-line" + (node.text ? "" : " empty");
                line.style.paddingLeft = `calc(${node.depth} * 20px + var(--text-indent))`;
                setLineDisplayContent(line, node.text, false, node.index);
                applyIndentGuides(line, node.depth);

                line.onfocus = () => {
                    state.activeTabId = tab.id;
                    state.activeLineIndex = node.index;
                    const selectionInfo = getSelectionOffsets(line);
                    const latestLineText = getDisplayText((getTabLines(getTabById(tab.id))[node.index]) || '');
                    setLineDisplayContent(line, latestLineText, true);
                    const pendingCaret = state.pendingCaret
                        && state.pendingCaret.tabId === tab.id
                        && state.pendingCaret.lineIndex === node.index
                        ? state.pendingCaret
                        : null;
                    if (pendingCaret) state.pendingCaret = null;
                    requestAnimationFrame(() => {
                        if (pendingCaret) {
                            placeCaret(line, pendingCaret.offset);
                        } else if (selectionInfo && !selectionInfo.collapsed) {
                            selectLineRange(line, selectionInfo.start, selectionInfo.end);
                        } else if (selectionInfo) {
                            placeCaret(line, selectionInfo.end);
                        }
                    });
                    if (state.preserveSelectionOnFocus) state.preserveSelectionOnFocus = false;
                    else if (!state.dragSelecting) clearSelectedLineSelection();
                    updateToolbarUI();
                };

                line.onblur = () => {
                    const latestLineText = getDisplayText((getTabLines(getTabById(tab.id))[node.index]) || (line.textContent || ''));
                    setLineDisplayContent(line, latestLineText, false, node.index);
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
                    const rowIsSelected = isLineIndexSelected(tab.id, node.index);
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
                    clearSelectedLineSelection();
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
                    requestRender('editor', { immediate: true });
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
                    updateContent(tab.id, nextLines.join('\n'), null, { coalesceTyping: true });
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
                            const indices = selectedRange.indices || getSelectedLineIndices(tab.id);
                            let nextLines = [...currentLines];
                            const segments = [];
                            let segmentStart = indices[0];
                            let previous = indices[0];
                            for (let i = 1; i < indices.length; i++) {
                                if (indices[i] !== previous + 1) {
                                    segments.push([segmentStart, previous]);
                                    segmentStart = indices[i];
                                }
                                previous = indices[i];
                            }
                            segments.push([segmentStart, previous]);
                            [...segments].reverse().forEach(([start, end]) => {
                                nextLines = tab.outlineModeActive && !state.tempOutlineDisabled
                                    ? shiftOutlineRange(nextLines, start, end, e.shiftKey ? -1 : 1, true)
                                    : shiftLineRange(nextLines, start, end, e.shiftKey ? -1 : 1);
                            });
                            clearSelectedLineSelection();
                            updateTabLines(tab.id, nextLines, indices[0], 0);
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
                                else marker = formatOutlineMarker(info.type, (info.value || 0) + 1, state.norm.separator) + " ";
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
                                extendLineSelectionTo(tab.id, target.index);
                                state.preserveSelectionOnFocus = true;
                                requestRender('editor', { immediate: true });
                            } else {
                                clearSelectedLineSelection();
                                state.selectedLineAnchor = { tabId: tab.id, index: target.index };
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
            const container = domRefs['editor-container'];
            if (!container) return;
            const scrollByTabId = new Map(
                Array.from(container.querySelectorAll('.editor-cell[data-editor-tab]')).map(cell => [
                    cell.dataset.editorTab,
                    { top: cell.scrollTop, left: cell.scrollLeft }
                ])
            );
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
            container.querySelectorAll('.editor-cell[data-editor-tab]').forEach(cell => {
                const previous = scrollByTabId.get(cell.dataset.editorTab);
                if (!previous) return;
                cell.scrollTop = previous.top;
                cell.scrollLeft = previous.left;
            });
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
                {id: 'toggle-word-wrap', active: t.showWordWrap},
                {id: 'toggle-outline-mode', active: t.outlineModeActive},
                {id: 'toggle-hide-completed', active: t.hideCompletedLines}
            ];
            
            toggles.forEach(item => {
                const btn = domRefs[item.id];
                if (btn) {
                    if (item.active) btn.classList.add('btn-active');
                    else btn.classList.remove('btn-active');
                }
            });

            const orientBtn = domRefs['toggle-tab-orientation'];
            const isVertical = state.theme.orientation === 'vertical';
            const orientIcon = domRefs['orient-icon'];
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

            domRefs['status-filename'].innerText = t.title;
            domRefs['stat-lines'].innerText = lines;
            domRefs['stat-words'].innerText = words;
            domRefs['stat-chars'].innerText = chars;
            domRefs['stat-time'].innerText = readTime + "m";

            const mvBtn = domRefs['toggle-view-mode'];
            if (state.multiViewIds.length > 1) {
                mvBtn.classList.remove('hidden');
                setViewModeIcon(state.multiViewMode);
            } else mvBtn.classList.add('hidden');

            domRefs['undo-btn'].disabled = !canUndo();
            domRefs['redo-btn'].disabled = !canRedo();
            domRefs['manual-save-btn'].title = isTabDirty(t)
                ? `Save (last saved ${formatManualSaveTime(t.manualSavedAt)})`
                : `Saved ${formatManualSaveTime(t.manualSavedAt)}`;
            domRefs['manual-save-all-btn'].title = areAnyTabsDirty()
                ? 'Save All'
                : 'All Tabs Saved';
            domRefs['restore-save-btn'].disabled = !isTabDirty(t);
            domRefs['restore-save-btn'].title = isTabDirty(t)
                ? `Jump Back To Last Save (${formatManualSaveTime(t.manualSavedAt)})`
                : 'Already At Last Save';
            domRefs['save-status'].innerText = isTabDirty(t)
                ? 'Autosaved · Revision pending'
                : `Revision saved ${formatManualSaveTime(t.manualSavedAt)}`;
            domRefs['open-find-btn'].classList.toggle('btn-active', state.search.open);
            const canTransform = canTransformSelectedText();
            domRefs['text-transform-group']?.classList.toggle('hidden', !canTransform);
            domRefs['text-transform-group']?.classList.toggle('flex', canTransform);
            ['transform-upper-btn', 'transform-lower-btn', 'transform-sentence-btn', 'transform-title-btn'].forEach(id => {
                if (domRefs[id]) domRefs[id].disabled = !canTransform;
            });

            domRefs['zip-export-toggle'].checked = state.theme.zipExport;
            
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
            const template = parseOutlineStyleTemplate(type);
            if (template) {
                let token = String(value);
                if (template.kind === 'alpha') token = String.fromCharCode((template.caseMode === 'upper' ? 64 : 96) + value);
                if (template.kind === 'roman') token = numToRoman(value, template.caseMode === 'lower') || String(value);
                return `${template.prefix}${token}${template.suffix}`;
            }
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
                return replaceLineMarker(line, info, info.indent, info.type, counters[info.indent]);
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
                marker = formatOutlineMarker(info.type, (info.value || 0) + 1, state.norm.separator);
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

        function getFocusedEditableLine() {
            const active = document.activeElement;
            return active && active.classList?.contains('outline-line') ? active : null;
        }

        function canTransformSelectedText() {
            const line = getFocusedEditableLine();
            const selection = line ? getSelectionOffsets(line) : null;
            return Boolean(selection && !selection.collapsed);
        }

        function transformSelectedText(mode) {
            const line = getFocusedEditableLine();
            if (!line || !mode) return;
            const selection = getSelectionOffsets(line);
            if (!selection || selection.collapsed) return;
            const tabId = line.dataset.tabLine.split(':')[0];
            const lineIndex = Number(line.dataset.lineIndex);
            const tab = getTabById(tabId);
            if (!tab || !Number.isInteger(lineIndex)) return;
            const currentLines = [...getTabLines(tab)];
            const rawLine = currentLines[lineIndex];
            const leadingTabs = (rawLine.match(/^\t*/) || [''])[0];
            const displayText = getDisplayText(rawLine);
            const selectedText = displayText.slice(selection.start, selection.end);
            let transformed = selectedText;

            if (mode === 'upper') transformed = selectedText.toUpperCase();
            if (mode === 'lower') transformed = selectedText.toLowerCase();
            if (mode === 'sentence') {
                const lower = selectedText.toLowerCase();
                transformed = lower.charAt(0).toUpperCase() + lower.slice(1);
            }
            if (mode === 'title') {
                transformed = selectedText.toLowerCase().replace(/\b([a-z])/g, match => match.toUpperCase());
            }

            currentLines[lineIndex] = leadingTabs + displayText.slice(0, selection.start) + transformed + displayText.slice(selection.end);
            state.pendingCaret = { tabId, lineIndex, offset: selection.start + transformed.length };
            updateTabLines(tabId, currentLines, lineIndex, selection.start + transformed.length);
            requestAnimationFrame(() => {
                const nextLine = getLineEditor(tabId, lineIndex);
                if (!nextLine) return;
                nextLine.focus({ preventScroll: true });
                selectLineRange(nextLine, selection.start, selection.start + transformed.length);
            });
        }

        function printCurrentTab() {
            const tab = getActiveTab();
            if (!tab) return;
            const includeLineNumbers = Boolean(domRefs['print-line-numbers-toggle']?.checked);
            const lines = getTabLines(tab);
            const content = lines.map((line, index) => {
                const text = escapeHtml(line.replace(/\t/g, '    '));
                return includeLineNumbers
                    ? `<div><span class="print-ln">${index + 1}</span><span>${text || '&nbsp;'}</span></div>`
                    : `<div>${text || '&nbsp;'}</div>`;
            }).join('');
            const printWindow = window.open('', '_blank', 'width=900,height=700');
            if (!printWindow) return;
            printWindow.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(tab.title)}</title><style>
                body{font-family:Consolas,Menlo,monospace;margin:24px;color:#111827;background:#fff;}
                .print-lines{white-space:pre-wrap;line-height:1.6;font-size:13px;}
                .print-lines > div{display:flex;gap:12px;min-height:22px;}
                .print-ln{display:inline-block;width:36px;color:#64748b;text-align:right;flex-shrink:0;}
            </style></head><body><div class="print-lines">${content}</div></body></html>`);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        }

        function applyTheme() {
            const root = document.documentElement; const { accent, mode } = state.theme;
            root.style.setProperty('--accent-color', accent);
            document.body.classList.remove('theme-light', 'theme-dark', 'theme-matrix');
            if (mode !== 'default') document.body.classList.add('theme-' + mode);
            domRefs['hex-accent'].value = accent.replace('#', '');
            if (domRefs['accent-color-picker']) domRefs['accent-color-picker'].value = accent;
            if (domRefs['accent-swatch-btn']) domRefs['accent-swatch-btn'].style.backgroundColor = accent;
            domRefs['norm-separator'].value = state.norm.separator;
            domRefs.outlineLevelInputs.forEach((input, index) => {
                input.value = getOutlineStyleLabel(getOutlineLevels()[index] || DEFAULT_OUTLINE_LEVELS[index]);
            });
            domRefs.modeButtons.forEach(btn => {
                const isActive = btn.dataset.mode === mode;
                btn.style.backgroundColor = isActive ? accent : 'transparent';
                btn.style.color = isActive ? 'white' : 'inherit';
                btn.style.borderColor = isActive ? accent : 'var(--border-color)';
            });
            requestRender('full');
        }

        function flushSaveToStorage() {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            const payload = serializePersistenceState();
            localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(payload.tabs));
            localStorage.setItem(STORAGE_KEY_ACTIVE, payload.activeTabId);
            localStorage.setItem(STORAGE_KEY_THEME, JSON.stringify(payload.themeData));
            localStorage.setItem(STORAGE_KEY_RECOVERY, JSON.stringify({
                savedAt: Date.now(),
                ...payload
            }));
            const status = domRefs['save-status'];
            if (status) status.innerText = "Synced " + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        }

        function saveToStorage() {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                flushSaveToStorage();
            }, SAVE_DEBOUNCE_MS);
        }

        function addTab(title = 'untitled.txt', content = '') {
            const nextState = createTabState({
                tabs: state.tabs,
                title,
                content,
                createId: makeTabId
            });
            state.tabs = nextState.tabs;
            state.activeTabId = nextState.activeTabId;
            saveToStorage();
            requestRender('full');
            focusEditorAtStart(nextState.activeTabId);
        }

        function closeTab(id) { 
            if (state.tabs.length > 1) {
                const closeResult = closeTabState({
                    tabs: state.tabs,
                    multiViewIds: state.multiViewIds,
                    activeTabId: state.activeTabId,
                    tabId: id
                });
                if (!closeResult) return;
                recordGlobalAction({
                    type: 'close-tab',
                    tabSnapshot: createTabRecord({
                        ...closeResult.closingTab,
                        collapsedLines: [...(closeResult.closingTab.collapsedLines || [])]
                    }),
                    index: closeResult.closeIndex,
                    activeTabIdBefore: state.activeTabId,
                    multiViewIdsBefore: [...state.multiViewIds]
                });
                state.tabs = closeResult.tabs;
                state.multiViewIds = closeResult.multiViewIds;
                state.activeTabId = closeResult.activeTabId;
                saveToStorage();
                requestRender('full');
            }
        }

        function updateContent(id, content, textarea, options = {}) {
            const t = getTabById(id); if (!t) return;
            if (t.content !== content) recordTabHistory(id, undefined, { coalesceTyping: Boolean(options.coalesceTyping) });
            t.content = content;
            invalidateTabCaches(id);
            let shouldRenderTabs = true;
            if (!t.manuallyRenamed) {
                t.title = deriveTitleFromText(getCachedLines(content, `${id}:title`)[0]);
            }
            saveToStorage();
            if (shouldRenderTabs || id === state.activeTabId) {
                requestRender({
                    layout: false,
                    tabs: shouldRenderTabs,
                    editor: false,
                    toolbar: id === state.activeTabId,
                    find: id === state.activeTabId
                });
            }
        }

        function toggleSettings(open) {
            const menu = domRefs['settings-menu'], overlay = domRefs['settings-overlay'];
            if (!menu || !overlay) return;
            if (open) {
                menu.classList.add('open');
                overlay.classList.remove('hidden');
                overlay.style.pointerEvents = 'auto';
                requestAnimationFrame(() => { overlay.style.opacity = "1"; });
                return;
            }
            menu.classList.remove('open');
            overlay.style.opacity = "0";
            overlay.style.pointerEvents = 'none';
            setTimeout(() => { overlay.classList.add('hidden'); }, 200);
        }

        function init() {
            const savedTabs = localStorage.getItem(STORAGE_KEY_TABS), savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE), savedThemeData = localStorage.getItem(STORAGE_KEY_THEME);
            const savedRecovery = localStorage.getItem(STORAGE_KEY_RECOVERY);
            let primaryStateLoaded = false;

            const parsedTabs = safeParseJSON(savedTabs, null);
            state.tabs = parsedTabs ? hydrateTabs(parsedTabs) : [createDefaultTab()];
            primaryStateLoaded = Boolean(parsedTabs);

            state.activeTabId = getTabById(savedActiveId) ? savedActiveId : state.tabs[0].id;

            if (savedThemeData) {
                const parsedTheme = safeParseJSON(savedThemeData, null);
                if (parsedTheme) {
                    const p = normalizePersistedThemePayload(parsedTheme);
                    state.theme = p.theme;
                    state.norm = p.norm;
                    state.multiViewIds = p.multiViewIds.filter(id => getTabById(id)).slice(0, 4);
                    state.multiViewMode = p.multiViewMode;
                } else {
                    state.multiViewIds = [];
                    state.multiViewMode = 'vert';
                }
            }

            const shouldUseRecovery = !primaryStateLoaded && Boolean(savedRecovery);
            if (shouldUseRecovery && savedRecovery) {
                const recovery = safeParseJSON(savedRecovery, null);
                if (recovery) {
                    state.tabs = hydrateTabs(recovery.tabs);
                    state.activeTabId = getTabById(recovery.activeTabId) ? recovery.activeTabId : state.tabs[0].id;
                    const themePayload = normalizePersistedThemePayload(recovery.themeData);
                    state.theme = themePayload.theme;
                    state.norm = themePayload.norm;
                    state.multiViewIds = themePayload.multiViewIds.filter(id => getTabById(id)).slice(0, 4);
                    state.multiViewMode = themePayload.multiViewMode;
                } else {
                    debugInvariant('recovery snapshot failed to hydrate');
                }
            }

            cacheDomRefs();
            validateStateIntegrity('init');
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
            document.addEventListener('selectionchange', () => updateToolbarUI());
            document.addEventListener('keydown', (e) => updateHoveredLineDragReady(e.shiftKey));
            document.addEventListener('keyup', (e) => {
                if (e.key === 'Shift') updateHoveredLineDragReady(false);
            });
            document.addEventListener('mousemove', handlePendingLineDrag);
            document.addEventListener('mouseup', endDragSelection);
            domRefs['add-tab-btn'].onclick = () => addTab();
            domRefs['duplicate-tab-btn'].onclick = () => duplicateActiveTab();
            domRefs['import-btn'].onclick = () => domRefs['file-input'].click();
            domRefs['export-tab-btn'].onclick = () => {
                const t = state.tabs.find(x => x.id === state.activeTabId);
                if (t) {
                    triggerDownload(t.title, t.content);
                    markManualSave(t.id);
                }
            };
            domRefs['undo-btn'].onclick = () => performUndo();
            domRefs['redo-btn'].onclick = () => performRedo();
            domRefs['open-find-btn'].onclick = () => {
                if (state.search.open) closeFindBar();
                else openFindBar();
            };
            domRefs['manual-save-btn'].onclick = () => markManualSave(state.activeTabId);
            domRefs['manual-save-all-btn'].onclick = () => markManualSaveAll();
            domRefs['restore-save-btn'].onclick = () => restoreLastManualSave(state.activeTabId);
            domRefs['export-all-btn'].onclick = () => exportAll();
            domRefs['print-btn'].onclick = () => printCurrentTab();
            domRefs['find-next-btn'].onclick = () => goToSearchResult(state.search.currentIndex + 1);
            domRefs['find-input'].oninput = (e) => {
                state.search.query = e.target.value;
                invalidateSearchCache();
                refreshSearchResults();
                requestRender('editor');
            };
            domRefs['find-input'].onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    goToSearchResult(state.search.currentIndex + 1);
                }
            };
            domRefs['replace-input'].oninput = (e) => {
                state.search.replace = e.target.value;
                syncFindBarUi();
            };
            domRefs['replace-input'].onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    replaceCurrentSearchResult();
                }
            };
            domRefs['replace-btn'].onclick = () => replaceCurrentSearchResult();
            domRefs['replace-all-btn'].onclick = () => replaceAllSearchResults();
            domRefs['find-fuzzy-toggle'].onchange = (e) => {
                state.search.fuzzy = e.target.checked;
                invalidateSearchCache();
                refreshSearchResults();
                requestRender('editor');
            };
            domRefs['file-input'].onchange = (e) => { Array.from(e.target.files).forEach(file => { const r = new FileReader(); r.onload = (ev) => addTab(file.name, ev.target.result); r.readAsText(file); }); e.target.value = ''; };
            domRefs['open-settings-btn'].addEventListener('click', () => toggleSettings(true));
            domRefs['close-settings-btn'].addEventListener('click', () => toggleSettings(false));
            domRefs['settings-overlay'].addEventListener('click', () => toggleSettings(false));
            domRefs['toggle-tab-orientation'].onclick = () => mutateState(() => {
                state.theme.orientation = state.theme.orientation === 'horizontal' ? 'vertical' : 'horizontal';
            }, { render: 'full', save: true });
            domRefs['toggle-view-mode'].onclick = () => mutateState(() => {
                const modes = ['vert', 'horiz', 'card'];
                state.multiViewMode = modes[(modes.indexOf(state.multiViewMode) + 1) % modes.length];
            }, { render: 'full', save: true });
            domRefs.modeButtons.forEach(btn => {
                btn.onclick = () => mutateState(() => {
                    state.theme.mode = btn.dataset.mode;
                    applyTheme();
                }, { save: true });
            });
            domRefs['accent-swatch-btn'].onclick = () => {
                domRefs['accent-color-picker']?.click();
            };
            domRefs['accent-color-picker'].oninput = (e) => {
                mutateState(() => {
                    state.theme.accent = e.target.value;
                    applyTheme();
                }, { save: true });
            };
            domRefs['hex-accent'].oninput = (e) => {
                if (!/^[0-9A-Fa-f]{6}$/.test(e.target.value)) return;
                mutateState(() => {
                    state.theme.accent = '#' + e.target.value;
                    applyTheme();
                }, { save: true });
            };
            domRefs['zip-export-toggle'].onchange = (e) => mutateState(() => { state.theme.zipExport = e.target.checked; }, { save: true, render: 'toolbar' });
            domRefs['norm-separator'].oninput = (e) => mutateState(() => {
                state.norm.separator = e.target.value;
                applyTheme();
            }, { save: true });
            domRefs.outlineLevelInputs.forEach(input => {
                input.onchange = (e) => {
                    const index = Number(e.target.dataset.levelIndex);
                    const nextLevels = [...getOutlineLevels()];
                    nextLevels[index] = normalizeOutlineStyleInput(e.target.value, nextLevels[index] || DEFAULT_OUTLINE_LEVELS[index]);
                    mutateState(() => {
                        state.norm.levels = nextLevels;
                        applyTheme();
                    }, { save: true });
                };
            });
            domRefs['reset-theme-btn'].onclick = () => mutateState(() => {
                state.theme = { accent: '#2563eb', mode: 'default', orientation: 'horizontal', zipExport: false };
                state.norm = { separator: '.', levels: [...DEFAULT_OUTLINE_LEVELS] };
                applyTheme();
            }, { save: true });
            domRefs['toggle-line-numbers'].onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.showLineNumbers = !t.showLineNumbers; }, { render: 'full', save: true });
            };
            domRefs['toggle-zebra'].onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.showZebra = !t.showZebra; }, { render: 'editor', save: true });
            };
            domRefs['toggle-word-wrap'].onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.showWordWrap = !t.showWordWrap; }, { render: 'editor', save: true });
            };
            domRefs['toggle-outline-mode'].onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.outlineModeActive = !t.outlineModeActive; }, { render: 'editor', save: true });
            };
            domRefs['toggle-hide-completed'].onclick = () => {
                const t = getActiveTab(); if (!t) return;
                mutateState(() => { t.hideCompletedLines = !t.hideCompletedLines; }, { render: 'editor', save: true });
            };
            domRefs['transform-upper-btn'].onclick = () => transformSelectedText('upper');
            domRefs['transform-lower-btn'].onclick = () => transformSelectedText('lower');
            domRefs['transform-sentence-btn'].onclick = () => transformSelectedText('sentence');
            domRefs['transform-title-btn'].onclick = () => transformSelectedText('title');
        }

        window.onload = init;



(function (global) {
    function getStorageKeys(version = 54) {
        return {
            tabs: `tabforge_tabs_v${version}`,
            active: `tabforge_active_v${version}`,
            theme: `tabforge_theme_v${version}`,
            recovery: `tabforge_recovery_v${version}`
        };
    }

    function safeParseJSON(rawValue, fallback = null) {
        if (!rawValue) return fallback;
        try {
            return JSON.parse(rawValue);
        } catch {
            return fallback;
        }
    }

    function normalizeThemePayload(payload, fallbackTheme, fallbackNorm, defaultOutlineLevels) {
        const defaultSpecialColors = fallbackTheme?.specialColors || {};
        const savedTheme = payload?.theme && typeof payload.theme === 'object' ? payload.theme : {};
        const isColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
        const specialColors = Object.fromEntries(Object.entries(defaultSpecialColors).map(([key, value]) =>
            [key, isColor(savedTheme.specialColors?.[key]) ? savedTheme.specialColors[key] : value]
        ));
        return {
            theme: {
                ...fallbackTheme,
                ...savedTheme,
                accent: isColor(savedTheme.accent) ? savedTheme.accent : fallbackTheme.accent,
                mode: ['default', 'light', 'dark', 'matrix'].includes(savedTheme.mode) ? savedTheme.mode : fallbackTheme.mode,
                orientation: ['horizontal', 'vertical'].includes(savedTheme.orientation) ? savedTheme.orientation : fallbackTheme.orientation,
                editorFontSize: Number.isFinite(savedTheme.editorFontSize) ? savedTheme.editorFontSize : fallbackTheme.editorFontSize,
                specialColors
            },
            norm: {
                separator: typeof payload?.norm?.separator === 'string' && payload.norm.separator ? payload.norm.separator : fallbackNorm.separator,
                levels: Array.isArray(payload?.norm?.levels) && payload.norm.levels.length === 7 && payload.norm.levels.every(level => typeof level === 'string' && level.length > 0)
                    ? payload.norm.levels
                    : [...defaultOutlineLevels]
            },
            multiViewIds: Array.isArray(payload?.multiViewIds) ? [...new Set(payload.multiViewIds.filter(id => typeof id === 'string'))] : [],
            multiViewMode: ['vert', 'horiz', 'card'].includes(payload?.multiViewMode) ? payload.multiViewMode : 'vert'
        };
    }

    function serializeStatePayload(state) {
        return {
            tabs: state.tabs,
            activeTabId: state.activeTabId,
            themeData: {
                theme: state.theme,
                norm: state.norm,
                multiViewIds: state.multiViewIds,
                multiViewMode: state.multiViewMode
            }
        };
    }

    function hasUsableTabs(tabs) {
        return Array.isArray(tabs) && tabs.some(tab =>
            tab && !Array.isArray(tab) && typeof tab === 'object' && typeof tab.content === 'string'
        );
    }

    // Commit one complete snapshot before updating the legacy storage keys. A
    // quota error or interrupted write must never leave a partially saved workspace.
    function createStateWriter(write, keys) {
        const written = new Map();
        let lastSnapshot = null;
        function writeChanged(key, value) {
            if (written.get(key) === value) return true;
            if (!write(key, value)) return false;
            written.set(key, value);
            return true;
        }
        return function save(payload) {
            const tabs = JSON.stringify(payload.tabs);
            const active = JSON.stringify(payload.activeTabId);
            const theme = JSON.stringify(payload.themeData);
            const snapshot = `"tabs":${tabs},"activeTabId":${active},"themeData":${theme}`;
            if (snapshot !== lastSnapshot) {
                if (!writeChanged(keys.recovery, `{"version":1,"savedAt":${Date.now()},${snapshot}}`)) return false;
                lastSnapshot = snapshot;
            }
            writeChanged(keys.tabs, tabs);
            writeChanged(keys.active, payload.activeTabId);
            writeChanged(keys.theme, theme);
            return true;
        };
    }

    global.TabForgePersistence = {
        getStorageKeys,
        safeParseJSON,
        normalizeThemePayload,
        serializeStatePayload,
        hasUsableTabs,
        createStateWriter
    };
})(window);

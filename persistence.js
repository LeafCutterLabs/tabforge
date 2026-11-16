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
        const savedTheme = payload?.theme || fallbackTheme;
        return {
            theme: {
                ...fallbackTheme,
                ...savedTheme,
                specialColors: {
                    ...defaultSpecialColors,
                    ...(savedTheme?.specialColors || {})
                }
            },
            norm: {
                separator: payload?.norm?.separator || fallbackNorm.separator,
                levels: Array.isArray(payload?.norm?.levels) && payload.norm.levels.length === 7
                    ? payload.norm.levels
                    : [...defaultOutlineLevels]
            },
            multiViewIds: Array.isArray(payload?.multiViewIds) ? payload.multiViewIds : [],
            multiViewMode: payload?.multiViewMode || 'vert'
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

    global.TabForgePersistence = {
        getStorageKeys,
        safeParseJSON,
        normalizeThemePayload,
        serializeStatePayload
    };
})(window);

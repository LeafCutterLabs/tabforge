(function (global) {
    function normalizeCollapsedLines(collapsedLines) {
        return Array.isArray(collapsedLines) ? collapsedLines.filter(Number.isInteger) : [];
    }

    function createTabRecord({
        id,
        title = 'untitled.txt',
        content = '',
        manuallyRenamed = false,
        showLineNumbers = true,
        showZebra = true,
        showWordWrap = false,
        outlineModeActive = false,
        outlineLevelFilter = null,
        hideCompletedLines = false,
        collapsedLines = [],
        manualSavedContent,
        manualSavedAt
    }) {
        return {
            id,
            title,
            content,
            manuallyRenamed,
            showLineNumbers,
            showZebra,
            showWordWrap,
            outlineModeActive,
            outlineLevelFilter: Number.isInteger(outlineLevelFilter) ? outlineLevelFilter : null,
            hideCompletedLines,
            collapsedLines: normalizeCollapsedLines(collapsedLines),
            manualSavedContent: typeof manualSavedContent === 'string' ? manualSavedContent : content,
            manualSavedAt: typeof manualSavedAt === 'number' ? manualSavedAt : Date.now()
        };
    }

    function hydrateTabRecord(tab, fallbackId) {
        return createTabRecord({
            id: typeof tab?.id === 'string' && tab.id ? tab.id : fallbackId,
            title: typeof tab?.title === 'string' && tab.title ? tab.title : 'untitled.txt',
            content: typeof tab?.content === 'string' ? tab.content : '',
            manuallyRenamed: Boolean(tab?.manuallyRenamed),
            showLineNumbers: tab?.showLineNumbers !== false,
            showZebra: tab?.showZebra !== false,
            showWordWrap: Boolean(tab?.showWordWrap),
            outlineModeActive: tab?.outlineModeActive !== false,
            outlineLevelFilter: Number.isInteger(tab?.outlineLevelFilter) ? tab.outlineLevelFilter : null,
            hideCompletedLines: Boolean(tab?.hideCompletedLines),
            collapsedLines: tab?.collapsedLines,
            manualSavedContent: tab?.manualSavedContent,
            manualSavedAt: tab?.manualSavedAt
        });
    }

    global.TabForgeTabModel = {
        createTabRecord,
        hydrateTabRecord
    };
})(window);

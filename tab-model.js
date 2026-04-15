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
            hideCompletedLines: Boolean(tab?.hideCompletedLines),
            collapsedLines: tab?.collapsedLines,
            manualSavedContent: tab?.manualSavedContent,
            manualSavedAt: tab?.manualSavedAt
        });
    }

    function duplicateTabRecord(source, { id, title }) {
        return createTabRecord({
            id,
            title,
            content: source.content,
            manuallyRenamed: true,
            showLineNumbers: source.showLineNumbers,
            showZebra: source.showZebra,
            showWordWrap: source.showWordWrap,
            outlineModeActive: source.outlineModeActive,
            hideCompletedLines: source.hideCompletedLines,
            collapsedLines: source.collapsedLines,
            manualSavedContent: source.content,
            manualSavedAt: Date.now()
        });
    }

    global.TabForgeTabModel = {
        createTabRecord,
        hydrateTabRecord,
        duplicateTabRecord
    };
})(window);

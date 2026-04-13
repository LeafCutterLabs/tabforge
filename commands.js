(function (global) {
    const { createTabRecord, duplicateTabRecord } = global.TabForgeTabModel;

    function insertAt(array, index, value) {
        const next = [...array];
        next.splice(index, 0, value);
        return next;
    }

    function createTabState({ tabs, title = 'untitled.txt', content = '', createId }) {
        const id = createId();
        const tab = createTabRecord({
            id,
            title,
            content,
            manuallyRenamed: title !== 'untitled.txt'
        });
        return {
            tabs: [...tabs, tab],
            activeTabId: id,
            tab
        };
    }

    function duplicateTabState({ tabs, activeTabId, createId, buildTitle }) {
        const source = tabs.find(tab => tab.id === activeTabId);
        if (!source) return null;
        const id = createId();
        const title = buildTitle(source.title);
        const copy = duplicateTabRecord(source, { id, title });
        const sourceIndex = tabs.findIndex(tab => tab.id === source.id);
        return {
            tabs: insertAt(tabs, sourceIndex + 1, copy),
            activeTabId: id,
            tab: copy
        };
    }

    function closeTabState({ tabs, multiViewIds, activeTabId, tabId }) {
        if (tabs.length <= 1) return null;
        const closeIndex = tabs.findIndex(tab => tab.id === tabId);
        if (closeIndex === -1) return null;
        const closingTab = tabs[closeIndex];
        const nextTabs = tabs.filter(tab => tab.id !== tabId);
        const nextMultiViewIds = multiViewIds.filter(id => id !== tabId);
        const nextActiveTabId = activeTabId === tabId ? nextTabs[0].id : activeTabId;
        return {
            tabs: nextTabs,
            multiViewIds: nextMultiViewIds,
            activeTabId: nextActiveTabId,
            closingTab,
            closeIndex
        };
    }

    global.TabForgeCommands = {
        createTabState,
        duplicateTabState,
        closeTabState
    };
})(window);

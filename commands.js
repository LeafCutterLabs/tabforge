(function (global) {
    const { createTabRecord } = global.TabForgeTabModel;

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
            activeTabId: id
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
        closeTabState
    };
})(window);

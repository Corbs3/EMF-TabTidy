// Auto-group on startup if enabled
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get({ autoGroup: false });
  if (!data.autoGroup) return;

  const tabs = await chrome.tabs.query({ currentWindow: true });

  const existingGroups = await chrome.tabGroups.query({});
  for (const group of existingGroups) {
    const groupTabs = await chrome.tabs.query({ groupId: group.id });
    if (groupTabs.length) await chrome.tabs.ungroup(groupTabs.map(t => t.id)).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 150));

  const GROUP_COLOURS = ['cyan', 'blue', 'green', 'purple', 'pink', 'orange', 'yellow', 'red', 'grey'];

  function getDomain(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      const parts = h.split('.');
      return parts.length > 2 ? parts.slice(-2).join('.') : h;
    } catch { return null; }
  }

  function cleanGroupName(domain) {
    const name = domain
      .replace(/\.(com|org|net|io|co|gov|edu|info|biz|me|app|dev|ai|uk|us|au|ca|de|fr|nl|se|no|dk)(\.[a-z]{2})?$/, '')
      .replace(/^(www|app|my|mail|docs|drive|meet|calendar)\./, '')
      .split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  const domainMap = {};
  for (const tab of tabs) {
    if (!tab.url || tab.pinned) continue;
    if (['chrome://', 'chrome-extension://', 'edge://', 'about:'].some(p => tab.url.startsWith(p))) continue;
    const domain = getDomain(tab.url);
    if (!domain) continue;
    if (!domainMap[domain]) domainMap[domain] = [];
    domainMap[domain].push(tab);
  }

  let colourIdx = 0;
  for (const [domain, domainTabs] of Object.entries(domainMap)) {
    if (domainTabs.length < 2) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds: domainTabs.map(t => t.id) });
      await new Promise(r => setTimeout(r, 50));
      await chrome.tabGroups.update(groupId, {
        title:     cleanGroupName(domain),
        color:     GROUP_COLOURS[colourIdx % GROUP_COLOURS.length],
        collapsed: true,
      });
      colourIdx++;
    } catch {}
  }
});

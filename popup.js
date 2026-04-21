const GROUP_COLOURS = ['cyan', 'blue', 'green', 'purple', 'pink', 'orange', 'yellow', 'red', 'grey'];
const SWATCH_COLOURS = {
  cyan: '#00BCD4', teal: '#00B6A8', green: '#4CAF50', blue: '#2196F3',
  purple: '#9C27B0', pink: '#E91E63', orange: '#FF9800', yellow: '#FFC107',
  red: '#F44336', grey: '#9E9E9E',
};

// ── UI refs ───────────────────────────────────────────────
const btnGroup        = document.getElementById('btn-group');
const btnUngroup      = document.getElementById('btn-ungroup');
const groupsEl        = document.getElementById('groups');
const summaryEl       = document.getElementById('summary');
const emptyEl         = document.getElementById('empty');
const statusEl        = document.getElementById('status');
const toolbar         = document.getElementById('toolbar');
const btnSaveSession  = document.getElementById('btn-save-session');
const sessionsSection = document.getElementById('sessions-section');
const sessionsList    = document.getElementById('sessions-list');
const sessionsToggle  = document.getElementById('sessions-toggle');
const sessionsChevron = document.getElementById('sessions-chevron');
const btnSettings     = document.getElementById('btn-settings');
const btnSettingsBack = document.getElementById('btn-settings-back');
const viewSettings    = document.getElementById('view-settings');
const toggleAutogroup = document.getElementById('toggle-autogroup');
const modalSave       = document.getElementById('modal-save-session');
const sessionInput    = document.getElementById('session-name-input');
const btnModalSave    = document.getElementById('btn-modal-save');
const btnModalCancel  = document.getElementById('btn-modal-cancel');

let currentSort = 'default';
let sessions    = [];
let autoGroup   = false;

// ── Helpers ───────────────────────────────────────────────
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

function showStatus(msg, duration = 2000) {
  statusEl.textContent = msg;
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), duration);
}

function isGroupable(tab) {
  if (!tab.url || tab.pinned) return false;
  return !['chrome://', 'chrome-extension://', 'edge://', 'about:'].some(p => tab.url.startsWith(p));
}

// ── Sort ──────────────────────────────────────────────────
document.querySelectorAll('.sort-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.sort-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentSort = pill.dataset.sort;
    renderGroups();
  });
});

function sortEntries(entries) {
  if (currentSort === 'alpha')  return [...entries].sort((a, b) => (a.group.title || '').localeCompare(b.group.title || ''));
  if (currentSort === 'count')  return [...entries].sort((a, b) => b.tabs.length - a.tabs.length);
  return entries; // default — tab bar order
}

// ── Group all tabs ────────────────────────────────────────
btnGroup.addEventListener('click', async () => {
  btnGroup.disabled    = true;
  btnGroup.textContent = 'Grouping…';
  await groupAllTabs();
  btnGroup.disabled    = false;
  btnGroup.textContent = 'Regroup tabs';
  await renderGroups();
});

async function groupAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Ungroup all first
  const existingGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of existingGroups) {
    const groupTabs = await chrome.tabs.query({ groupId: group.id });
    if (groupTabs.length) await chrome.tabs.ungroup(groupTabs.map(t => t.id)).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 150));

  const domainMap = {};
  for (const tab of tabs) {
    if (!isGroupable(tab)) continue;
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
  showStatus('✓ Tabs grouped');
}

// ── Ungroup all ───────────────────────────────────────────
btnUngroup.addEventListener('click', async () => {
  const existingGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of existingGroups) {
    const groupTabs = await chrome.tabs.query({ groupId: group.id });
    if (groupTabs.length) await chrome.tabs.ungroup(groupTabs.map(t => t.id)).catch(() => {});
  }
  showStatus('✓ All tabs ungrouped');
  await renderGroups();
});

// ── Render groups ─────────────────────────────────────────
async function renderGroups() {
  const tabs   = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

  const groupMap = {};
  for (const g of groups) groupMap[g.id] = { group: g, tabs: [] };

  let ungroupedCount = 0;
  for (const tab of tabs) {
    if (!tab.url) continue;
    const isSystem = ['chrome://', 'chrome-extension://', 'edge://', 'about:'].some(p => tab.url.startsWith(p));
    if (tab.groupId && tab.groupId !== -1 && groupMap[tab.groupId]) {
      groupMap[tab.groupId].tabs.push(tab);
    } else if (!isSystem && !tab.pinned) {
      ungroupedCount++;
    }
  }

  const entries = sortEntries(Object.values(groupMap).filter(e => e.tabs.length > 0));

  if (!entries.length) {
    groupsEl.innerHTML = '';
    summaryEl.style.display = 'none';
    toolbar.classList.remove('visible');
    emptyEl.classList.add('visible');
    return;
  }

  emptyEl.classList.remove('visible');
  toolbar.classList.add('visible');

  const totalTabs = entries.reduce((s, e) => s + e.tabs.length, 0);
  summaryEl.innerHTML = `<strong>${entries.length}</strong> group${entries.length !== 1 ? 's' : ''} · <strong>${totalTabs}</strong> tabs${ungroupedCount ? ` · ${ungroupedCount} ungrouped` : ''}`;
  summaryEl.style.display = 'block';

  groupsEl.innerHTML = entries.map(({ group, tabs: gTabs }) => {
    const swatch = SWATCH_COLOURS[group.color] || '#9E9E9E';
    const tabRows = gTabs.map(tab => {
      const favicon = tab.favIconUrl
        ? `<img class="tab-favicon" src="${tab.favIconUrl}" onerror="this.style.display='none'">`
        : `<div class="tab-favicon-placeholder"></div>`;
      const title = tab.title || 'Untitled';
      return `<div class="tab-row" data-tab-id="${tab.id}">
        ${favicon}
        <div class="tab-title" title="${title.replace(/"/g,'&quot;')}">${title}</div>
      </div>`;
    }).join('');

    return `<div class="group-block" data-group-id="${group.id}">
      <div class="group-header">
        <div class="group-swatch" style="background:${swatch}"></div>
        <div class="group-name" data-group-id="${group.id}">${group.title || 'Unnamed'}</div>
        <div class="group-count">${gTabs.length} tab${gTabs.length !== 1 ? 's' : ''}</div>
        <button class="btn-ungroup-single" data-group-id="${group.id}" title="Ungroup">✕</button>
        <div class="group-chevron">▶</div>
      </div>
      <div class="tab-list">${tabRows}</div>
    </div>`;
  }).join('');

  // Toggle expand
  groupsEl.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.group-name-input') || e.target.closest('.btn-ungroup-single')) return;
      header.closest('.group-block').classList.toggle('open');
    });
  });

  // Switch to tab
  groupsEl.querySelectorAll('.tab-row').forEach(row => {
    row.addEventListener('click', async () => {
      const tabId = parseInt(row.dataset.tabId);
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
    });
  });

  // Ungroup single group
  groupsEl.querySelectorAll('.btn-ungroup-single').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const groupId = parseInt(btn.dataset.groupId);
      const groupTabs = await chrome.tabs.query({ groupId });
      if (groupTabs.length) await chrome.tabs.ungroup(groupTabs.map(t => t.id)).catch(() => {});
      showStatus('✓ Group removed');
      await renderGroups();
    });
  });

  // Rename on dblclick
  groupsEl.querySelectorAll('.group-name').forEach(nameEl => {
    attachRename(nameEl);
  });
}

function attachRename(nameEl) {
  nameEl.addEventListener('dblclick', async (e) => {
    e.stopPropagation();
    const groupId = parseInt(nameEl.dataset.groupId);
    const current = nameEl.textContent;
    const input   = document.createElement('input');
    input.className = 'group-name-input';
    input.value     = current;
    nameEl.replaceWith(input);
    input.focus(); input.select();
    async function save() {
      const newName = input.value.trim() || current;
      await chrome.tabGroups.update(groupId, { title: newName });
      const newEl = document.createElement('div');
      newEl.className = 'group-name'; newEl.dataset.groupId = groupId;
      newEl.textContent = newName; input.replaceWith(newEl);
      attachRename(newEl);
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { input.value = current; save(); } });
  });
}

// ── Sessions ──────────────────────────────────────────────
sessionsToggle.addEventListener('click', () => {
  sessionsList.classList.toggle('open');
  sessionsChevron.textContent = sessionsList.classList.contains('open') ? '▼' : '▶';
});

btnSaveSession.addEventListener('click', () => {
  sessionInput.value = '';
  modalSave.style.display = 'flex';
  sessionInput.focus();
});

btnModalCancel.addEventListener('click', () => { modalSave.style.display = 'none'; });

btnModalSave.addEventListener('click', async () => {
  const name = sessionInput.value.trim();
  if (!name) return;

  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  const sessionGroups = [];
  for (const g of groups) {
    const gTabs = await chrome.tabs.query({ groupId: g.id });
    sessionGroups.push({
      title: g.title || 'Unnamed',
      color: g.color,
      urls:  gTabs.map(t => t.url).filter(Boolean),
    });
  }

  const data = await chrome.storage.local.get({ sessions: [] });
  data.sessions.unshift({ name, groups: sessionGroups, savedAt: Date.now() });
  if (data.sessions.length > 10) data.sessions = data.sessions.slice(0, 10);
  await chrome.storage.local.set({ sessions: data.sessions });
  sessions = data.sessions;

  modalSave.style.display = 'none';
  showStatus(`✓ Session "${name}" saved`);
  renderSessions();
});

sessionInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnModalSave.click(); if (e.key === 'Escape') btnModalCancel.click(); });

async function renderSessions() {
  const data = await chrome.storage.local.get({ sessions: [] });
  sessions   = data.sessions;

  if (!sessions.length) {
    sessionsSection.style.display = 'none';
    return;
  }

  sessionsSection.style.display = 'block';
  sessionsList.innerHTML = sessions.map((s, i) => {
    const date = new Date(s.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<div class="session-row">
      <div>
        <div class="session-name">${s.name}</div>
        <div class="session-meta">${s.groups.length} group${s.groups.length !== 1 ? 's' : ''} · ${date}</div>
      </div>
      <button class="btn-restore" data-i="${i}">Restore</button>
      <button class="btn-delete-session" data-i="${i}" title="Delete">✕</button>
    </div>`;
  }).join('');

  sessionsList.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', async () => {
      const session = sessions[parseInt(btn.dataset.i)];
      for (const g of session.groups) {
        if (!g.urls.length) continue;
        const tabIds = [];
        for (const url of g.urls) {
          try {
            const tab = await chrome.tabs.create({ url, active: false });
            tabIds.push(tab.id);
          } catch {}
        }
        if (tabIds.length) {
          const groupId = await chrome.tabs.group({ tabIds });
          await new Promise(r => setTimeout(r, 50));
          await chrome.tabGroups.update(groupId, { title: g.title, color: g.color, collapsed: true }).catch(() => {});
        }
      }
      showStatus(`✓ Session "${session.name}" restored`);
      await renderGroups();
    });
  });

  sessionsList.querySelectorAll('.btn-delete-session').forEach(btn => {
    btn.addEventListener('click', async () => {
      sessions.splice(parseInt(btn.dataset.i), 1);
      await chrome.storage.local.set({ sessions });
      renderSessions();
    });
  });
}

// ── Settings ──────────────────────────────────────────────
btnSettings.addEventListener('click', async () => {
  const data = await chrome.storage.local.get({ autoGroup: false });
  autoGroup  = data.autoGroup;
  toggleAutogroup.classList.toggle('on', autoGroup);
  viewSettings.style.display = 'flex';
});

btnSettingsBack.addEventListener('click', () => {
  viewSettings.style.display = 'none';
});

toggleAutogroup.addEventListener('click', async () => {
  autoGroup = !autoGroup;
  toggleAutogroup.classList.toggle('on', autoGroup);
  await chrome.storage.local.set({ autoGroup });
});

// ── Init ──────────────────────────────────────────────────
renderGroups();
renderSessions();

// TabTidy popup. Shared logic lives in tidy.js (window.Tidy).

const $ = id => document.getElementById(id);

// Build elements safely (tab titles come from web pages, so never use innerHTML for them)
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortEvery = m => m < 60 ? `every ${m} min` : m === 60 ? 'hourly' : `every ${m / 60} hours`;
const CHIP_LABELS = { 0: 'Off', 15: '15 min', 30: '30 min', 60: '1 hour', 240: '4 hours' };
const WIN = chrome.windows.WINDOW_ID_CURRENT;

let currentSort = 'default';
let rules = [];
let sessions = [];
let dupeSets = [];
let statusTimer;

function showStatus(msg) {
  const s = $('status');
  s.textContent = msg;
  s.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => s.classList.remove('visible'), 2200);
}

function favicon(tab) {
  if (!tab.favIconUrl || tab.favIconUrl.startsWith('chrome://')) return el('span', { class: 'favicon blank' });
  const img = el('img', { class: 'favicon', src: tab.favIconUrl, alt: '' });
  img.addEventListener('error', () => img.replaceWith(el('span', { class: 'favicon blank' })));
  return img;
}

async function focusTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
}

// ── Tidy / ungroup ────────────────────────────────────────
$('btn-group').addEventListener('click', async () => {
  const btn = $('btn-group');
  btn.disabled = true;
  btn.textContent = 'Tidying…';
  $('dusty-head').classList.add('busy');
  const made = await Tidy.groupWindow((await chrome.windows.getCurrent()).id, rules);
  $('dusty-head').classList.remove('busy');
  btn.disabled = false;
  btn.textContent = 'Tidy again';
  showStatus(made ? `All tidy! ${plural(made, 'group')} made` : 'Nothing to group yet');
  await refresh();
});

$('btn-ungroup').addEventListener('click', async () => {
  await Tidy.ungroupWindow((await chrome.windows.getCurrent()).id);
  showStatus('All tabs ungrouped');
  await refresh();
});

// ── Sort ──────────────────────────────────────────────────
document.querySelectorAll('.sort-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.sort-pill').forEach(p => p.classList.toggle('active', p === pill));
    currentSort = pill.dataset.sort;
    renderGroups();
  });
});

function sortEntries(entries) {
  if (currentSort === 'alpha') return [...entries].sort((a, b) => (a.group.title || '').localeCompare(b.group.title || ''));
  if (currentSort === 'count') return [...entries].sort((a, b) => b.tabs.length - a.tabs.length);
  return entries;
}

// ── Header + duplicates ───────────────────────────────────
async function refresh() {
  const tabs = await chrome.tabs.query({ windowId: WIN });
  const open = tabs.filter(t => !Tidy.isSystem(t.url)).length;
  const { autoMinutes } = await chrome.storage.local.get({ autoMinutes: 0 });
  $('tagline').replaceChildren(`${plural(open, 'tab')} open`);
  if (autoMinutes) $('tagline').append(', ', el('span', { class: 'auto-on', text: `auto tidy ${shortEvery(autoMinutes)}` }));
  renderDupes(tabs);
  await renderGroups(tabs);
}

function renderDupes(tabs) {
  dupeSets = Tidy.findDuplicates(tabs);
  const extras = dupeSets.reduce((n, s) => n + s.extras.length, 0);
  $('dupes').hidden = extras === 0;
  if (!extras) return;

  $('dupes-text').replaceChildren(
    'Dusty spotted ', el('strong', { text: plural(extras, 'duplicate tab') })
  );
  $('btn-close-dupes').textContent = extras === 1 ? 'Close it' : 'Close extras';
  $('dupes-list').replaceChildren(...dupeSets.map(set =>
    el('li', {},
      favicon(set.keep),
      el('span', { class: 'tab-title', text: set.keep.title || set.keep.url, title: set.keep.url }),
      el('span', { class: 'count', text: `×${set.extras.length + 1}` })
    )
  ));
}

$('dupes-toggle').addEventListener('click', () => {
  const list = $('dupes-list');
  list.hidden = !list.hidden;
  $('dupes-toggle').setAttribute('aria-expanded', String(!list.hidden));
  $('dupes-toggle').textContent = list.hidden ? 'Show which ones' : 'Hide list';
});

$('btn-close-dupes').addEventListener('click', async () => {
  const ids = dupeSets.flatMap(s => s.extras.map(t => t.id));
  if (!ids.length) return;
  await chrome.tabs.remove(ids).catch(() => {});
  showStatus(`Closed ${plural(ids.length, 'duplicate tab')}`);
  await refresh();
});

// ── Groups list ───────────────────────────────────────────
async function renderGroups(tabs) {
  tabs = tabs || await chrome.tabs.query({ windowId: WIN });
  const groups = await chrome.tabGroups.query({ windowId: WIN });
  const map = new Map(groups.map(g => [g.id, { group: g, tabs: [] }]));
  for (const tab of tabs) if (tab.groupId !== -1 && map.has(tab.groupId)) map.get(tab.groupId).tabs.push(tab);
  const entries = sortEntries([...map.values()].filter(e => e.tabs.length));

  const container = $('groups');
  $('empty').hidden = entries.length > 0;
  $('toolbar').hidden = entries.length === 0;
  if (entries.length) $('btn-group').textContent = $('btn-group').disabled ? 'Tidying…' : 'Tidy again';

  container.replaceChildren(...entries.map(({ group, tabs: gTabs }) => {
    const block = el('div', { class: 'group' });
    const nameEl = el('span', { class: 'group-name', text: group.title || 'Unnamed', title: 'Double-click to rename' });
    const head = el('div', {
      class: 'group-head', role: 'button', tabindex: '0', 'aria-expanded': 'false',
    },
      el('span', { class: 'swatch', style: `background:${Tidy.SWATCH[group.color] || '#888'}` }),
      nameEl,
      el('span', { class: 'group-count', text: plural(gTabs.length, 'tab') }),
      el('button', { class: 'mini-btn', title: 'Ungroup these tabs', text: 'Ungroup', onclick: async e => {
        e.stopPropagation();
        await chrome.tabs.ungroup(gTabs.map(t => t.id)).catch(() => {});
        showStatus(`"${group.title || 'Group'}" ungrouped`);
        refresh();
      } }),
      el('button', { class: 'mini-btn', title: 'Close every tab in this group', text: 'Close', onclick: async e => {
        e.stopPropagation();
        await chrome.tabs.remove(gTabs.map(t => t.id)).catch(() => {});
        showStatus(`Closed ${plural(gTabs.length, 'tab')}`);
        refresh();
      } }),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' })
    );
    const toggle = () => {
      block.classList.toggle('open');
      head.setAttribute('aria-expanded', String(block.classList.contains('open')));
    };
    head.addEventListener('click', e => { if (!e.target.closest('input')) toggle(); });
    head.addEventListener('keydown', e => {
      if (e.target !== head) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'F2') startRename(nameEl, group);
    });
    nameEl.addEventListener('dblclick', e => { e.stopPropagation(); startRename(nameEl, group); });

    const list = el('div', { class: 'tab-list' }, gTabs.map(tab =>
      el('button', { class: 'tab-row', onclick: () => focusTab(tab.id) },
        favicon(tab),
        el('span', { class: 'tab-title', text: tab.title || 'Untitled', title: tab.title || '' })
      )
    ));
    block.append(head, list);
    return block;
  }));
}

function startRename(nameEl, group) {
  const current = nameEl.textContent;
  const input = el('input', { class: 'group-name-input', value: current, 'aria-label': 'Group name' });
  nameEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  async function finish(save) {
    if (done) return; done = true;
    const name = save ? (input.value.trim() || current) : current;
    if (name !== current) await chrome.tabGroups.update(group.id, { title: name }).catch(() => {});
    renderGroups();
  }
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

// ── Sessions ──────────────────────────────────────────────
$('sessions-toggle').addEventListener('click', () => {
  const list = $('sessions-list');
  list.hidden = !list.hidden;
  $('sessions-toggle').setAttribute('aria-expanded', String(!list.hidden));
});

// Overlays sit on top of the main view, so make the popup tall enough to fit them
function syncHeight() {
  const open = !$('view-settings').hidden || !$('modal-rule').hidden || !$('modal-save-session').hidden;
  document.body.classList.toggle('tall', open);
}
function openModal(id, focusId) { $(id).hidden = false; syncHeight(); if (focusId) $(focusId).focus(); }
function closeModal(id) { $(id).hidden = true; syncHeight(); }

$('btn-save-session').addEventListener('click', () => {
  $('session-name-input').value = '';
  openModal('modal-save-session', 'session-name-input');
});
$('btn-modal-cancel').addEventListener('click', () => closeModal('modal-save-session'));
$('session-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-modal-save').click();
  if (e.key === 'Escape') closeModal('modal-save-session');
});

$('btn-modal-save').addEventListener('click', async () => {
  const name = $('session-name-input').value.trim();
  if (!name) { $('session-name-input').focus(); return; }
  const groups = await chrome.tabGroups.query({ windowId: WIN });
  const saved = [];
  for (const g of groups) {
    const gTabs = await chrome.tabs.query({ groupId: g.id });
    saved.push({ title: g.title || 'Unnamed', color: g.color, urls: gTabs.map(t => t.url).filter(Boolean) });
  }
  const data = await chrome.storage.local.get({ sessions: [] });
  data.sessions.unshift({ name, groups: saved, savedAt: Date.now() });
  sessions = data.sessions.slice(0, 10);
  await chrome.storage.local.set({ sessions });
  closeModal('modal-save-session');
  showStatus(`Saved "${name}"`);
  renderSessions();
});

async function renderSessions() {
  sessions = (await chrome.storage.local.get({ sessions: [] })).sessions;
  $('sessions-section').hidden = sessions.length === 0;
  $('sessions-list').replaceChildren(...sessions.map((s, i) => {
    const date = new Date(s.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return el('div', { class: 'session' },
      el('div', { class: 'session-info' },
        el('div', { class: 'session-name', text: s.name }),
        el('div', { class: 'session-meta', text: `${plural(s.groups.length, 'group')}, saved ${date}` })
      ),
      el('button', { class: 'link-btn', text: 'Restore', onclick: () => restoreSession(s) }),
      el('button', { class: 'mini-btn', text: 'Delete', 'aria-label': `Delete ${s.name}`, onclick: async () => {
        sessions.splice(i, 1);
        await chrome.storage.local.set({ sessions });
        renderSessions();
      } })
    );
  }));
}

async function restoreSession(session) {
  for (const g of session.groups) {
    const tabIds = [];
    for (const url of g.urls) {
      try { tabIds.push((await chrome.tabs.create({ url, active: false })).id); } catch {}
    }
    if (!tabIds.length) continue;
    const groupId = await chrome.tabs.group({ tabIds });
    await Tidy.wait(50);
    await chrome.tabGroups.update(groupId, { title: g.title, color: g.color, collapsed: true }).catch(() => {});
  }
  showStatus(`Restored "${session.name}"`);
  refresh();
}

// ── Settings ──────────────────────────────────────────────
$('btn-settings').addEventListener('click', async () => {
  const { autoGroup } = await chrome.storage.local.get({ autoGroup: false });
  $('toggle-autogroup').setAttribute('aria-checked', String(autoGroup));
  const { singleGroups } = await chrome.storage.local.get({ singleGroups: false });
  $('toggle-singles').setAttribute('aria-checked', String(singleGroups));
  await renderAutoTidy();
  renderRules();
  $('view-settings').hidden = false;
  syncHeight();
  $('btn-settings-back').focus();
});
$('btn-settings-back').addEventListener('click', () => { $('view-settings').hidden = true; syncHeight(); $('btn-settings').focus(); });

$('toggle-autogroup').addEventListener('click', async () => {
  const on = $('toggle-autogroup').getAttribute('aria-checked') !== 'true';
  $('toggle-autogroup').setAttribute('aria-checked', String(on));
  await chrome.storage.local.set({ autoGroup: on });
});

$('toggle-singles').addEventListener('click', async () => {
  const on = $('toggle-singles').getAttribute('aria-checked') !== 'true';
  $('toggle-singles').setAttribute('aria-checked', String(on));
  await chrome.storage.local.set({ singleGroups: on });
});

// ── Auto tidy ─────────────────────────────────────────────
async function renderAutoTidy() {
  const { autoMinutes, lastAutoTidy } = await chrome.storage.local.get({ autoMinutes: 0, lastAutoTidy: 0 });
  $('auto-chips').replaceChildren(...Tidy.AUTO_OPTIONS.map(o =>
    el('button', {
      class: 'chip', role: 'radio', 'aria-checked': String(o.minutes === autoMinutes),
      'aria-label': o.label, text: CHIP_LABELS[o.minutes],
      onclick: async () => {
        await chrome.storage.local.set({ autoMinutes: o.minutes });
        await Tidy.syncAlarm();
        showStatus(o.minutes ? `Auto tidy: ${o.label.toLowerCase()}` : 'Auto tidy is off');
        renderAutoTidy();
        refresh();
      },
    })
  ));
  const when = lastAutoTidy
    ? new Date(lastAutoTidy).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  $('last-tidy').textContent = !autoMinutes ? '' : when ? `Last auto tidy: ${when}` : 'First auto tidy coming up soon.';
}

// ── Group rules ───────────────────────────────────────────
function renderRules() {
  const list = $('rules-list');
  if (!rules.length) {
    list.replaceChildren(el('li', { class: 'rule-empty', text: 'No categories. Tabs will be grouped by website.' }));
    return;
  }
  list.replaceChildren(...rules.map(rule => {
    const on = rule.enabled !== false;
    return el('li', { class: 'rule-row' + (on ? '' : ' off') },
      el('button', { class: 'rule', 'aria-label': `Edit ${rule.name}`, onclick: () => openRuleEditor(rule) },
        el('span', { class: 'swatch', style: `background:${Tidy.SWATCH[rule.color]}` }),
        el('span', {},
          el('div', { class: 'rule-name', text: rule.name }),
          el('div', { class: 'rule-sites', text: rule.patterns.join(', ') })
        )
      ),
      el('button', {
        class: 'toggle small', role: 'switch', 'aria-checked': String(on), 'aria-label': `${rule.name} on or off`,
        onclick: async () => {
          rules = rules.map(r => r.id === rule.id ? { ...r, enabled: !on } : r);
          await Tidy.saveRules(rules);
          renderRules();
        },
      })
    );
  }));
}

let editingId = null;
let chosenColour = 'blue';

function renderSwatches() {
  $('rule-colours').replaceChildren(...Tidy.GROUP_COLOURS.map(c =>
    el('button', {
      class: 'swatch-btn', role: 'radio', 'aria-label': c, 'aria-checked': String(c === chosenColour),
      style: `background:${Tidy.SWATCH[c]}`,
      onclick: () => { chosenColour = c; renderSwatches(); },
    })
  ));
}

function openRuleEditor(rule) {
  editingId = rule ? rule.id : null;
  $('rule-title').textContent = rule ? 'Edit category' : 'New category';
  $('rule-name').value = rule ? rule.name : '';
  $('rule-patterns').value = rule ? rule.patterns.join('\n') : '';
  $('rule-error').textContent = '';
  $('btn-rule-delete').hidden = !rule;
  const used = new Set(rules.map(r => r.color));
  chosenColour = rule ? rule.color : (Tidy.GROUP_COLOURS.find(c => !used.has(c)) || 'blue');
  renderSwatches();
  openModal('modal-rule', 'rule-name');
}

$('btn-add-rule').addEventListener('click', () => openRuleEditor(null));
$('btn-rule-cancel').addEventListener('click', () => closeModal('modal-rule'));
$('modal-rule').addEventListener('keydown', e => { if (e.key === 'Escape') closeModal('modal-rule'); });

$('btn-rule-save').addEventListener('click', async () => {
  const name = $('rule-name').value.trim();
  const patterns = [...new Set($('rule-patterns').value.split(/[\n,]+/).map(Tidy.normalisePattern).filter(p => p && p.includes('.')))];
  if (!name) { $('rule-error').textContent = 'Give the category a name.'; $('rule-name').focus(); return; }
  if (!patterns.length) { $('rule-error').textContent = 'Add at least one website, like zoom.us'; $('rule-patterns').focus(); return; }

  if (editingId) {
    rules = rules.map(r => r.id === editingId ? { ...r, name, patterns, color: chosenColour } : r);
  } else {
    rules.push({ id: 'r-' + Date.now().toString(36), name, patterns, color: chosenColour, enabled: true });
  }
  await Tidy.saveRules(rules);
  closeModal('modal-rule');
  renderRules();
  showStatus(`"${name}" saved`);
});

$('btn-rule-delete').addEventListener('click', async () => {
  rules = rules.filter(r => r.id !== editingId);
  await Tidy.saveRules(rules);
  closeModal('modal-rule');
  renderRules();
});

$('btn-reset-rules').addEventListener('click', async () => {
  rules = Tidy.DEFAULT_RULES.map(r => ({ ...r, patterns: [...r.patterns] }));
  await Tidy.saveRules(rules);
  renderRules();
  showStatus('Suggested categories restored');
});

// ── Start ─────────────────────────────────────────────────
(async () => {
  rules = await Tidy.getRules();
  await refresh();
  await renderSessions();
})();

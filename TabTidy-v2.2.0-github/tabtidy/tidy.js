// TabTidy shared logic: used by both the popup and the background service worker.
// Everything here runs locally. No data leaves the browser.

const Tidy = (() => {
  // Chrome's own tab group colours, in the order domain groups cycle through them
  const GROUP_COLOURS = ['blue', 'pink', 'green', 'purple', 'orange', 'cyan', 'yellow', 'red', 'grey'];

  // Close match to how Chrome draws each group colour (used for swatches in the popup)
  const SWATCH = {
    grey: '#5F6368', blue: '#1A73E8', red: '#D93025', yellow: '#F9AB00', green: '#188038',
    pink: '#D01884', purple: '#A142F4', cyan: '#007B83', orange: '#FA903E',
  };

  // Browser pages that can't (or shouldn't) be grouped
  const SYSTEM_PREFIXES = [
    'chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://',
    'view-source:', 'arc://', 'dia://', 'comet://',
  ];

  // Two-part endings, so bbc.co.uk groups as "bbc" rather than "co"
  const SECOND_LEVEL = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'net.uk', 'sch.uk', 'police.uk',
    'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz', 'org.nz', 'co.za', 'com.br', 'co.jp',
    'co.in', 'com.cn', 'com.sg', 'com.mx', 'co.kr', 'com.hk',
  ]);

  // Ready-made categories so staff have useful groups straight away.
  // A site can be a whole website (slack.com) or part of one (bbc.co.uk/news).
  // The most specific match wins, so linkedin.com/learning beats linkedin.com.
  const DEFAULT_RULES = [
    { id: 'r-docs',     name: 'Docs & Drive',    color: 'blue',   patterns: ['docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com', 'forms.google.com'] },
    { id: 'r-mail',     name: 'Mail & Calendar', color: 'red',    patterns: ['mail.google.com', 'calendar.google.com', 'contacts.google.com'] },
    { id: 'r-meetings', name: 'Meetings',        color: 'green',  patterns: ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com'] },
    { id: 'r-chat',     name: 'Chat',            color: 'purple', patterns: ['slack.com', 'chat.google.com'] },
    { id: 'r-ai',       name: 'AI',              color: 'cyan',   patterns: ['gemini.google.com', 'notebooklm.google.com', 'claude.ai', 'chatgpt.com', 'chat.openai.com'] },
    { id: 'r-design',   name: 'Design',          color: 'pink',   patterns: ['canva.com', 'figma.com', 'miro.com', 'mural.co', 'express.adobe.com'] },
    { id: 'r-people',   name: 'People & HR',     color: 'orange', patterns: ['hibob.com'] },
    { id: 'r-crm',      name: 'CRM',             color: 'blue',   patterns: ['salesforce.com', 'force.com'] },
    { id: 'r-projects', name: 'Projects',        color: 'yellow', patterns: ['asana.com', 'notion.so', 'notion.com', 'trello.com', 'monday.com'] },
    { id: 'r-social',   name: 'Social',          color: 'purple', patterns: ['linkedin.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'bsky.app', 'threads.net', 'threads.com', 'youtube.com'] },
    { id: 'r-travel',   name: 'Travel',          color: 'green',  patterns: ['thetrainline.com', 'nationalrail.co.uk', 'booking.com', 'skyscanner.net'] },
    { id: 'r-learning', name: 'Learning',        color: 'orange', patterns: ['coursera.org', 'linkedin.com/learning', 'udemy.com', 'skillshop.withgoogle.com'] },
    { id: 'r-news',     name: 'News',            color: 'grey',   patterns: [
      'bbc.co.uk/news', 'bbc.com/news', 'news.sky.com', 'theguardian.com', 'independent.co.uk', 'telegraph.co.uk',
      'thetimes.com', 'thetimes.co.uk', 'ft.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'economist.com', 'news.google.com',
      'edie.net', 'trellis.net', 'greenbiz.com', 'businessgreen.com', 
    ] },
  ].map(r => ({ ...r, enabled: true }));

  // Categories that shipped in 2.0/2.1, so people who deleted one don't get it back
  const FIRST_DEFAULTS = ['r-docs', 'r-mail', 'r-meetings'];

  const wait = ms => new Promise(r => setTimeout(r, ms));

  function isSystem(url) {
    return !url || SYSTEM_PREFIXES.some(p => url.startsWith(p));
  }

  function isGroupable(tab) {
    return !!tab.url && !tab.pinned && !isSystem(tab.url);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return null; }
  }

  // Registrable domain, e.g. docs.google.com -> google.com, news.bbc.co.uk -> bbc.co.uk
  function getDomain(url) {
    const host = hostOf(url);
    if (!host) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.')) return host;
    const parts = host.split('.');
    const lastTwo = parts.slice(-2).join('.');
    if (SECOND_LEVEL.has(lastTwo) && parts.length > 2) return parts.slice(-3).join('.');
    return lastTwo;
  }

  const NICE_NAMES = {
    github: 'GitHub', youtube: 'YouTube', linkedin: 'LinkedIn', chatgpt: 'ChatGPT', openai: 'OpenAI',
    hibob: 'HiBob', bbc: 'BBC', paypal: 'PayPal', wordpress: 'WordPress', stackoverflow: 'Stack Overflow',
    hubspot: 'HubSpot', sharepoint: 'SharePoint', claude: 'Claude', miro: 'Miro', canva: 'Canva', ui: 'UI',
  };

  function cleanGroupName(domain) {
    const first = domain.split('.')[0] || domain;
    return NICE_NAMES[first] || first.charAt(0).toUpperCase() + first.slice(1);
  }

  // Turns whatever the user typed ("https://www.Zoom.us/j/123", "*.google.com") into a bare host
  function normalisePattern(input) {
    let p = String(input || '').trim().toLowerCase();
    p = p.replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '').replace(/^www\./, '');
    p = p.split(/[?#]/)[0].replace(/\/+$/, '');
    return p;
  }

  // How closely a pattern matches a page: 0 = no match, higher = more specific
  function matchScore(pattern, host, path) {
    const [ph, ...rest] = pattern.split('/');
    if (!(host === ph || host.endsWith('.' + ph))) return 0;
    const sub = rest.join('/');
    if (!sub) return 1;
    return (path === '/' + sub || path.startsWith('/' + sub + '/')) ? 2 : 0;
  }

  // Picks the switched-on category with the most specific match (first one wins a tie)
  function findRule(url, rules) {
    let u; try { u = new URL(url); } catch { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.toLowerCase();
    let best = null, bestScore = 0;
    for (const r of rules) {
      if (r.enabled === false) continue;
      const score = Math.max(0, ...r.patterns.map(p => matchScore(p, host, path)));
      if (score > bestScore) { best = r; bestScore = score; }
    }
    return best;
  }

  // Work out which tabs go where. Rule groups form with any number of tabs;
  // website groups need at least two tabs (a group of one isn't much tidier).
  function buildPlan(tabs, rules, singles = false) {
    const buckets = new Map();
    for (const tab of tabs) {
      if (!isGroupable(tab)) continue;
      const rule = findRule(tab.url, rules);
      let key, title, color = null, fromRule = false;
      if (rule) {
        key = 'rule:' + rule.id; title = rule.name; color = rule.color; fromRule = true;
      } else {
        const domain = getDomain(tab.url);
        if (!domain) continue;
        key = 'domain:' + domain; title = cleanGroupName(domain);
      }
      if (!buckets.has(key)) buckets.set(key, { key, title, color, fromRule, tabIds: [] });
      buckets.get(key).tabIds.push(tab.id);
    }
    return [...buckets.values()].filter(b => b.tabIds.length >= (b.fromRule && singles ? 1 : 2));
  }

  async function ungroupWindow(windowId) {
    const groups = await chrome.tabGroups.query({ windowId });
    for (const g of groups) {
      const gTabs = await chrome.tabs.query({ groupId: g.id });
      if (gTabs.length) await chrome.tabs.ungroup(gTabs.map(t => t.id)).catch(() => {});
    }
  }

  // Groups one window only, so other windows are left alone
  async function groupWindow(windowId, rules) {
    const tabs = await chrome.tabs.query({ windowId });
    await ungroupWindow(windowId);
    await wait(150);

    const { singleGroups } = await chrome.storage.local.get({ singleGroups: false });
    const plan = buildPlan(tabs, rules, singleGroups);
    const ruleColours = new Set(plan.filter(b => b.color).map(b => b.color));
    const spare = GROUP_COLOURS.filter(c => !ruleColours.has(c));
    const cycle = spare.length ? spare : GROUP_COLOURS;

    const keys = {};
    let i = 0, made = 0;
    for (const bucket of plan) {
      try {
        const groupId = await chrome.tabs.group({ tabIds: bucket.tabIds, createProperties: { windowId } });
        await wait(50);
        await chrome.tabGroups.update(groupId, {
          title: bucket.title,
          color: bucket.color || cycle[i++ % cycle.length],
          collapsed: true,
        });
        keys[groupId] = bucket.key;
        made++;
      } catch {}
    }
    const all = await getGroupKeys();
    await setGroupKeys({ ...all, ...keys });
    return made;
  }

  // Same page = same address, ignoring #anchors and a trailing slash
  function normaliseUrl(url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.hash = '';
      let s = u.protocol + '//' + u.hostname.toLowerCase() + (u.port ? ':' + u.port : '') + u.pathname.replace(/\/+$/, '') + u.search;
      return s;
    } catch { return null; }
  }

  // Returns sets of duplicates. In each set we keep the tab you're on,
  // or else the one you used most recently.
  function findDuplicates(tabs) {
    const map = new Map();
    for (const tab of tabs) {
      if (tab.pinned) continue;
      const key = normaliseUrl(tab.url);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tab);
    }
    const sets = [];
    for (const list of map.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) =>
        (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
      sets.push({ keep: sorted[0], extras: sorted.slice(1) });
    }
    return sets;
  }


  // ── Auto tidy ───────────────────────────────────────────
  // Choices shown in Settings (minutes; 0 = off)
  const AUTO_OPTIONS = [
    { minutes: 0,   label: 'Off' },
    { minutes: 15,  label: 'Every 15 minutes' },
    { minutes: 30,  label: 'Every 30 minutes' },
    { minutes: 60,  label: 'Every hour' },
    { minutes: 240, label: 'Every 4 hours' },
  ];
  const ALARM = 'tabtidy-auto';

  // Start, change or stop the auto tidy timer to match the saved setting
  async function syncAlarm() {
    const { autoMinutes } = await chrome.storage.local.get({ autoMinutes: 0 });
    const existing = await chrome.alarms.get(ALARM);
    if (!autoMinutes) { if (existing) await chrome.alarms.clear(ALARM); return; }
    if (existing && existing.periodInMinutes === autoMinutes) return;
    await chrome.alarms.create(ALARM, { delayInMinutes: autoMinutes, periodInMinutes: autoMinutes });
  }

  // Remember which group TabTidy made for which website or rule, so renamed groups
  // still get new tabs added to them. Kept in session storage (cleared when the browser closes).
  async function getGroupKeys() {
    try { return (await chrome.storage.session.get({ groupKeys: {} })).groupKeys; } catch { return {}; }
  }
  async function setGroupKeys(map) {
    try { await chrome.storage.session.set({ groupKeys: map }); } catch {}
  }

  function bucketFor(tab, rules) {
    const rule = findRule(tab.url, rules);
    if (rule) return { key: 'rule:' + rule.id, title: rule.name, color: rule.color, fromRule: true };
    const domain = getDomain(tab.url);
    if (!domain) return null;
    return { key: 'domain:' + domain, title: cleanGroupName(domain), color: null, fromRule: false };
  }

  // Gentle tidy: only sorts ungrouped tabs. Existing groups (and any names you gave them) are kept.
  // The tab you're looking at is skipped, so nothing moves under you.
  async function tidyNewTabs(windowId, rules) {
    const tabs = await chrome.tabs.query({ windowId });
    const groups = await chrome.tabGroups.query({ windowId });
    const keys = await getGroupKeys();
    const { singleGroups } = await chrome.storage.local.get({ singleGroups: false });
    const liveIds = new Set(groups.map(g => g.id));

    // Find a home for each key: first a group TabTidy made, then a group with the same title
    const homeByKey = new Map();
    for (const [gid, key] of Object.entries(keys)) if (liveIds.has(+gid)) homeByKey.set(key, +gid);
    const groupByTitle = new Map(groups.map(g => [(g.title || '').toLowerCase(), g.id]));

    const buckets = new Map();
    for (const tab of tabs) {
      if (tab.groupId !== -1 || tab.active || !isGroupable(tab)) continue;
      const b = bucketFor(tab, rules);
      if (!b) continue;
      if (!buckets.has(b.key)) buckets.set(b.key, { ...b, tabIds: [] });
      buckets.get(b.key).tabIds.push(tab.id);
    }

    const used = new Set(groups.map(g => g.color));
    let moved = 0;
    for (const b of buckets.values()) {
      const home = homeByKey.get(b.key) ?? groupByTitle.get(b.title.toLowerCase());
      try {
        if (home !== undefined) {
          await chrome.tabs.group({ groupId: home, tabIds: b.tabIds });
          moved += b.tabIds.length;
          continue;
        }
        if (b.tabIds.length < (b.fromRule && singleGroups ? 1 : 2)) continue;
        const color = b.color || GROUP_COLOURS.find(c => !used.has(c)) || GROUP_COLOURS[used.size % GROUP_COLOURS.length];
        used.add(color);
        const groupId = await chrome.tabs.group({ tabIds: b.tabIds, createProperties: { windowId } });
        await wait(50);
        await chrome.tabGroups.update(groupId, { title: b.title, color, collapsed: true });
        keys[groupId] = b.key;
        moved += b.tabIds.length;
      } catch {}
    }
    await setGroupKeys(keys);
    return moved;
  }

  async function autoTidyAllWindows() {
    const rules = await getRules();
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    let moved = 0;
    for (const win of windows) moved += await tidyNewTabs(win.id, rules);
    await chrome.storage.local.set({ lastAutoTidy: Date.now() });
    return moved;
  }

  async function getRules() {
    const data = await chrome.storage.local.get({ rules: null });
    return Array.isArray(data.rules) ? data.rules : DEFAULT_RULES.map(r => ({ ...r, patterns: [...r.patterns] }));
  }

  // On update, add any new ready-made categories. Ones the person deleted or changed are left alone.
  async function addNewDefaults() {
    const data = await chrome.storage.local.get({ rules: null, seenDefaults: FIRST_DEFAULTS });
    if (Array.isArray(data.rules)) {
      const have = new Set(data.rules.map(r => r.id));
      const fresh = DEFAULT_RULES.filter(r => !have.has(r.id) && !data.seenDefaults.includes(r.id));
      if (fresh.length) await chrome.storage.local.set({ rules: [...data.rules, ...fresh.map(r => ({ ...r, patterns: [...r.patterns] }))] });
    }
    await chrome.storage.local.set({ seenDefaults: DEFAULT_RULES.map(r => r.id) });
  }

  async function saveRules(rules) {
    await chrome.storage.local.set({ rules });
  }

  return {
    GROUP_COLOURS, SWATCH, DEFAULT_RULES,
    isSystem, isGroupable, getDomain, cleanGroupName, normalisePattern,
    buildPlan, ungroupWindow, groupWindow, findDuplicates, getRules, saveRules, wait,
    AUTO_OPTIONS, syncAlarm, addNewDefaults, findRule, tidyNewTabs, autoTidyAllWindows, ALARM,
  };
})();

if (typeof self !== 'undefined') self.Tidy = Tidy;

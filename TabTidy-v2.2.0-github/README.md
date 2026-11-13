# TabTidy

A Chrome extension that tidies your open tabs into groups, with a little help from **Dusty**, a cheerful feather duster.

## Features

- **Tidy my tabs** groups tabs in the current window by website, colour-coded
- **Ready-made categories** for common work tools (Docs & Drive, Mail & Calendar, Meetings, Chat, AI, Design, People & HR, CRM, Projects, Social, Travel, Learning, News). Switch any off, edit them, or add your own
- **Duplicate finder** spots tabs open more than once and closes the extras in one click (it keeps the one you're on, or used most recently)
- **Sort groups** by tab order, A to Z, or biggest first
- **Expand a group** to see its tabs and jump to one
- **Rename** a group by double-clicking its name (or press F2)
- **Ungroup or close** a single group
- **Save sessions** and restore them later (up to 10)
- **Auto tidy** (optional) sorts new tabs into groups every 15 minutes, 30 minutes, hour or 4 hours. Existing groups and their names are kept, and the tab you're on is left alone
- **Tidy on start-up** (optional) groups every window when the browser opens
- Keyboard friendly, and respects "reduce motion"

## How grouping works

1. Tabs that match a **category** go into that category's group (needs two tabs, unless "Group single tabs" is on)
2. Everything else is grouped by **website**, when there are two or more tabs from it
3. Pinned tabs and browser pages (like `chrome://`) are left alone

A category site can be a whole website (`google.com` also covers `mail.google.com`) or part of one (`bbc.co.uk/news`). The most specific match wins, so `linkedin.com/learning` goes to Learning and the rest of LinkedIn goes to Social.

## Auto tidy vs Tidy my tabs

| | Tidy my tabs | Auto tidy |
|---|---|---|
| When | When you press the button | On the timer you choose |
| Existing groups | Rebuilt from scratch | Kept, new tabs are added to them |
| Renamed groups | Reset | Kept |
| The tab you're on | Grouped | Left alone until next time |

## Duplicate matching

Tabs count as duplicates when their address matches, ignoring `#anchors`, a trailing slash and capital letters in the site name. Anything after `?` must match exactly.

## Installation (Developer Mode)

1. Download or clone this repository
2. Go to `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and choose the `tabtidy` folder

## Files

| File | What it does |
|---|---|
| `tidy.js` | Shared logic: grouping, rules, duplicate finding |
| `popup.html` / `popup.css` / `popup.js` | The popup |
| `background.js` | Auto tidy timer and tidy on start-up |

## Privacy

TabTidy keeps everything on your device. See [PRIVACY.md](PRIVACY.md).

## Changelog

### 2.2.0
- New: 13 ready-made categories, including News with sustainability news sites
- New: switch each category on or off
- New: "Group single tabs" setting (off by default)
- Categories can match part of a site, like `bbc.co.uk/news`
- "Group rules" renamed to "Categories"
- Updating keeps any categories you changed or deleted

### 2.1.0
- New: Auto tidy, with a choice of how often it runs
- Auto tidy keeps your groups and names, and skips the tab you're on
- New groups from the start-up tidy and the button are remembered, so auto tidy can add to them even after you rename them
- Main screen shows when auto tidy is on

### 2.0.0
- New look with Dusty the mascot
- New: group rules, with suggested rules for Google Workspace and meetings
- New: duplicate tab finder
- New: close a whole group
- Fixed: UK addresses like `bbc.co.uk` now group correctly
- Fixed: tidy on start-up now handles every window without losing groups
- Fixed: tab titles are always shown as plain text
- Friendlier names for well-known sites (GitHub, YouTube, LinkedIn)

### 1.1.0
- Saved sessions, sorting, renaming and tidy on start-up

## Licence

MIT

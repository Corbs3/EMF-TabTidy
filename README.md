# TabTidy

A Chrome extension that automatically groups your open tabs by domain and keeps your browser organised.

Built for anyone who ends up with 30+ tabs open and no idea what belongs where.

## Features

- **One-click grouping** - groups all open tabs by domain instantly
- **Colour-coded groups** - each group gets a distinct colour automatically
- **Sort options** - order groups by default, A-Z, or tab count
- **Expand/collapse groups** - click any group to see its tabs
- **Switch to tab** - click a tab row to jump straight to it
- **Rename groups** - double-click any group name to rename it inline
- **Ungroup single groups** - remove one group without affecting the rest
- **Ungroup all** - flatten everything back to ungrouped tabs
- **Save sessions** - snapshot your current groups and restore them later (up to 10 sessions)
- **Auto-group on startup** - optional setting to group tabs automatically when Chrome starts

## Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `tabtidy` folder

## How It Works

TabTidy uses Chrome's native `tabGroups` API to group and manage tabs:

1. On clicking "Group all tabs", it queries all open tabs in the current window
2. Tabs are mapped by domain (e.g. all `notion.so` tabs go in one group)
3. Groups of 2 or more are created and assigned a colour and a clean name
4. Pinned tabs and browser system pages are always excluded
5. Sessions are saved to `storage.local` and can be restored at any time

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Read tab URLs and titles to group by domain |
| `tabGroups` | Create, update, and remove tab groups |
| `storage` | Save sessions and settings locally |

No data is sent anywhere. Everything stays in your browser.

## File Structure

```
tabtidy/
  manifest.json   Extension config and permissions
  background.js   Service worker - handles auto-group on startup
  popup.html      Extension popup UI and styles
  popup.js        Grouping logic, session management, and settings
  icons/          Extension icons (16px, 48px, 128px)
```

## Licence

MIT

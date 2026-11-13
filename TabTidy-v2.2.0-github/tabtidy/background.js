importScripts('tidy.js');

// Make sure the auto tidy timer matches the saved setting
chrome.runtime.onInstalled.addListener(async () => {
  await Tidy.addNewDefaults();
  await Tidy.syncAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await Tidy.syncAlarm();

  // Tidy when the browser starts, if switched on. Each window is grouped on its own.
  const { autoGroup } = await chrome.storage.local.get({ autoGroup: false });
  if (!autoGroup) return;
  await Tidy.wait(1500); // give the browser a moment to restore tabs
  const rules = await Tidy.getRules();
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) await Tidy.groupWindow(win.id, rules);
});

// Auto tidy on a timer: only sorts new, ungrouped tabs
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === Tidy.ALARM) Tidy.autoTidyAllWindows();
});

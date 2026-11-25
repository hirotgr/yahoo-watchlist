importScripts("config.js");

const CONFIG = globalThis.YWM_CONFIG;
const STORAGE_KEY = "managedWatchlistWindow";
const INITIAL_WINDOW_WIDTH = 1100;

const tabQueues = new Map();
let openRequest;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWatchlistUrl(value) {
  return CONFIG.isAllowedWatchlistUrl(value);
}

async function readSettings() {
  const stored = await chrome.storage.local.get(CONFIG.SETTINGS_KEY);
  return CONFIG.normalizeSettings(stored[CONFIG.SETTINGS_KEY]);
}

async function readManagedWindow() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? null;
}

async function saveManagedWindow(record) {
  await chrome.storage.session.set({ [STORAGE_KEY]: record });
}

async function updateManagedWindowId(tabId, windowId) {
  const latestRecord = await readManagedWindow();
  if (latestRecord?.tabId !== tabId || latestRecord.windowId === windowId) return;
  await saveManagedWindow({ ...latestRecord, windowId });
}

async function clearManagedWindow(tabId) {
  const record = await readManagedWindow();
  if (record && (tabId === undefined || record.tabId === tabId)) {
    await chrome.storage.session.remove(STORAGE_KEY);
  }
}

function enqueueTabTask(tabId, task) {
  const previous = tabQueues.get(tabId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  tabQueues.set(tabId, current);

  current.finally(() => {
    if (tabQueues.get(tabId) === current) tabQueues.delete(tabId);
  }).catch(() => undefined);

  return current;
}

async function applyToManagedTab(tabId) {
  const record = await readManagedWindow();
  if (!record || record.tabId !== tabId) return;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    await clearManagedWindow(tabId);
    return;
  }

  if (record.windowId !== tab.windowId) return;
  if (!isWatchlistUrl(tab.url)) return;
  if (record.injectedUrl === tab.url) return;

  const windowInfo = await chrome.windows.get(tab.windowId);
  if (windowInfo?.type !== "popup") return;
  if (typeof windowInfo.width === "number" && windowInfo.width < 1000) {
    if (!record.pendingInitialResize) {
      await saveManagedWindow({ ...record, readyRestoreWidth: windowInfo.width });
    }
    await chrome.windows.update(tab.windowId, { width: INITIAL_WINDOW_WIDTH });
    await wait(200);
    tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== record.windowId || !isWatchlistUrl(tab.url)) return;
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["styles.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["config.js", "content.js"]
  });

  const latestRecord = await readManagedWindow();
  if (latestRecord?.tabId === tabId) {
    await saveManagedWindow({ ...latestRecord, injectedUrl: tab.url });
  }
}

async function focusOrCreateWatchlistWindow() {
  const settings = await readSettings();
  const record = await readManagedWindow();

  if (record?.tabId) {
    let tab;
    let windowInfo;
    try {
      tab = await chrome.tabs.get(record.tabId);
      windowInfo = await chrome.windows.get(tab.windowId);
    } catch {
      await clearManagedWindow(record.tabId);
    }

    if (tab && windowInfo?.type === "popup") {
      await updateManagedWindowId(tab.id, tab.windowId);
      await chrome.windows.update(tab.windowId, { focused: true });

      if (!isWatchlistUrl(tab.url)) {
        await chrome.tabs.update(tab.id, { url: settings.watchlistUrl, active: true });
      } else if (tab.status === "complete") {
        await enqueueTabTask(tab.id, () => applyToManagedTab(tab.id));
      }
      return;
    }

    if (tab) await clearManagedWindow(record.tabId);
  }

  const createdWindow = await chrome.windows.create({
    type: "popup",
    url: "about:blank",
    width: INITIAL_WINDOW_WIDTH,
    height: settings.windowHeight,
    focused: true
  });

  const createdTab = createdWindow?.tabs?.[0];
  if (!createdTab?.id || createdWindow?.id === undefined) {
    throw new Error("専用ウィンドウのタブを取得できませんでした。");
  }

  await saveManagedWindow({
    tabId: createdTab.id,
    windowId: createdWindow.id,
    injectedUrl: null,
    pendingInitialResize: true,
    targetWindowWidth: settings.windowWidth,
    readyRestoreWidth: null
  });

  try {
    await chrome.tabs.update(createdTab.id, {
      url: settings.watchlistUrl,
      active: true
    });
  } catch (error) {
    await clearManagedWindow(createdTab.id);
    await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw error;
  }
}

chrome.action.onClicked.addListener(() => {
  if (openRequest) return;

  openRequest = focusOrCreateWatchlistWindow()
    .catch((error) => {
      console.error("Yahoo!ファイナンス Watchlist Dockを開けませんでした。", error);
    })
    .finally(() => {
      openRequest = undefined;
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    enqueueTabTask(tabId, async () => {
      const record = await readManagedWindow();
      if (record?.tabId === tabId && record.injectedUrl !== null) {
        await saveManagedWindow({ ...record, injectedUrl: null });
      }
    }).catch((error) => console.warn("Watchlistの読み込み状態を更新できませんでした。", error));
  }

  if (changeInfo.status === "complete") {
    enqueueTabTask(tabId, () => applyToManagedTab(tabId))
      .catch((error) => console.warn("Watchlist Dockの準備に失敗しました。", error));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueTabTask(tabId, () => clearManagedWindow(tabId))
    .catch((error) => console.warn("閉じたWatchlistタブを整理できませんでした。", error));
});

chrome.windows.onRemoved.addListener((windowId) => {
  readManagedWindow()
    .then((record) => {
      if (record?.windowId === windowId) return clearManagedWindow(record.tabId);
      return undefined;
    })
    .catch((error) => console.warn("閉じたWatchlistウィンドウを整理できませんでした。", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "YWM_DOCK_READY") return;
  if (sender.frameId !== 0 || !sender.tab?.id) return;

  enqueueTabTask(sender.tab.id, async () => {
      const record = await readManagedWindow();
      if (record?.tabId !== sender.tab.id || record.windowId !== sender.tab.windowId) return;

      const latestTab = await chrome.tabs.get(sender.tab.id);
      if (latestTab.status !== "complete" ||
          latestTab.windowId !== record.windowId ||
          !isWatchlistUrl(latestTab.url)) return;

      if (record.pendingInitialResize) {
        await chrome.windows.update(latestTab.windowId, {
          width: record.targetWindowWidth
        });
        await saveManagedWindow({
          ...record,
          pendingInitialResize: false,
          targetWindowWidth: null
        });
      } else if (Number.isInteger(record.readyRestoreWidth)) {
        await chrome.windows.update(latestTab.windowId, {
          width: record.readyRestoreWidth
        });
        await saveManagedWindow({ ...record, readyRestoreWidth: null });
      }
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.warn("Watchlist Dockの表示状態を更新できませんでした。", error);
      sendResponse({ ok: false });
    });

  return true;
});

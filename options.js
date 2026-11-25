(() => {
  "use strict";

  const config = globalThis.YWM_CONFIG;
  const form = document.getElementById("settings-form");
  const urlInput = document.getElementById("watchlist-url");
  const widthInput = document.getElementById("window-width");
  const heightInput = document.getElementById("window-height");
  const status = document.getElementById("save-status");
  const restoreButton = document.getElementById("restore-defaults");

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.error = String(isError);
  }

  function displaySettings(settings) {
    urlInput.value = settings.watchlistUrl;
    widthInput.value = String(settings.windowWidth);
    heightInput.value = String(settings.windowHeight);
  }

  function readFormSettings() {
    const watchlistUrl = config.parseWatchlistUrl(urlInput.value);
    if (!watchlistUrl) {
      showStatus("Check the URL. Enter an allowed Watchlist page on finance.yahoo.com.", true);
      urlInput.focus();
      return null;
    }

    const windowWidth = Number(widthInput.value);
    if (!config.isDimensionValid(windowWidth, "windowWidth")) {
      showStatus("Enter a whole number from 240 to 1600 for the window width.", true);
      widthInput.focus();
      return null;
    }

    const windowHeight = Number(heightInput.value);
    if (!config.isDimensionValid(windowHeight, "windowHeight")) {
      showStatus("Enter a whole number from 400 to 1400 for the window height.", true);
      heightInput.focus();
      return null;
    }

    return { watchlistUrl, windowWidth, windowHeight };
  }

  async function saveSettings(settings, message) {
    try {
      await chrome.storage.local.set({ [config.SETTINGS_KEY]: settings });
      displaySettings(settings);
      showStatus(message);
    } catch (error) {
      console.error("Could not save Watchlist Dock settings.", error);
      showStatus("Could not save settings. Check your Chrome settings and try again.", true);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings = readFormSettings();
    if (settings) {
      saveSettings(settings, "Settings saved. They will take effect the next time you open the dedicated window.");
    }
  });

  restoreButton.addEventListener("click", () => {
    saveSettings(
      { ...config.DEFAULT_SETTINGS },
      "Defaults restored. They will take effect the next time you open the dedicated window."
    );
  });

  chrome.storage.local.get(config.SETTINGS_KEY)
    .then((stored) => {
      displaySettings(config.normalizeSettings(stored[config.SETTINGS_KEY]));
    })
    .catch((error) => {
      console.error("Could not load Watchlist Dock settings.", error);
      displaySettings(config.DEFAULT_SETTINGS);
      showStatus("Could not load saved settings. Showing defaults instead.", true);
    });
})();

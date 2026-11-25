(() => {
  "use strict";

  const SETTINGS_KEY = "watchlistDockSettings";
  const DEFAULT_SETTINGS = Object.freeze({
    watchlistUrl: "https://finance.yahoo.com/watchlists",
    windowWidth: 400,
    windowHeight: 900
  });
  const LIMITS = Object.freeze({
    windowWidth: Object.freeze({ min: 240, max: 1600 }),
    windowHeight: Object.freeze({ min: 400, max: 1400 })
  });

  function getAllowedPath(pathname) {
    const normalizedPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    if (normalizedPath === "/watchlists") return normalizedPath;
    if (/^\/watchlist\/.+$/.test(normalizedPath)) {
      return normalizedPath;
    }
    return null;
  }

  function parseWatchlistUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:" ||
          url.hostname !== "finance.yahoo.com" ||
          url.port !== "" ||
          url.username !== "" ||
          url.password !== "" ||
          !getAllowedPath(url.pathname)) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function isDimensionValid(value, dimension) {
    const limit = LIMITS[dimension];
    return Boolean(limit) &&
      Number.isInteger(value) &&
      value >= limit.min &&
      value <= limit.max;
  }

  function normalizeSettings(value) {
    const settings = value && typeof value === "object" ? value : {};
    return {
      watchlistUrl: parseWatchlistUrl(settings.watchlistUrl) || DEFAULT_SETTINGS.watchlistUrl,
      windowWidth: isDimensionValid(settings.windowWidth, "windowWidth")
        ? settings.windowWidth
        : DEFAULT_SETTINGS.windowWidth,
      windowHeight: isDimensionValid(settings.windowHeight, "windowHeight")
        ? settings.windowHeight
        : DEFAULT_SETTINGS.windowHeight
    };
  }

  globalThis.YWM_CONFIG = Object.freeze({
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    LIMITS,
    getAllowedPath,
    parseWatchlistUrl,
    isAllowedWatchlistUrl(value) {
      return parseWatchlistUrl(value) !== null;
    },
    isDimensionValid,
    normalizeSettings
  });
})();

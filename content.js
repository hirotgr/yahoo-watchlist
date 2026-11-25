(() => {
  const config = globalThis.YWM_CONFIG;
  const CONTROLLER_KEY = "__ywmDockControllerV1";
  const COMPACT_CLASS = "ywm-compact-view";
  const FIRST_WAIT_MS = 12000;
  const OPEN_WAIT_MS = 10000;

  function getWatchlistRouteKey() {
    if (location.hostname !== "finance.yahoo.com") return null;
    return config.getAllowedPath(location.pathname);
  }

  if (window[CONTROLLER_KEY]) return;
  const initialRouteKey = getWatchlistRouteKey();
  if (!initialRouteKey) return;
  window[CONTROLLER_KEY] = true;

  let routeKey = initialRouteKey;
  let routeGeneration = 0;

  function findDockParts() {
    const rail = document.querySelector("aside#right-rail[aria-label='Dock']");
    const dialog = rail?.querySelector("section.dock-rail > [role='dialog'][aria-label='Dock']");
    const dock = dialog?.querySelector("[data-testid='dock']");

    return {
      dialog,
      dock,
      openButton: document.querySelector("button[aria-label='Open dock']"),
      closeButton: document.querySelector("button[aria-label='Close dock']")
    };
  }

  function isActuallyVisible(element) {
    if (!element || element.getClientRects().length === 0) return false;

    for (let current = element; current instanceof Element; current = current.parentElement) {
      if (current.hidden) return false;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }
      if (Number.parseFloat(style.opacity) === 0) return false;
    }

    return true;
  }

  function isOpen(parts) {
    return Boolean(
      parts.dialog &&
      parts.dock &&
      isActuallyVisible(parts.dock) &&
      !parts.dialog.classList.contains("isCollapsed") &&
      !isActuallyVisible(parts.openButton)
    );
  }

  function isClosed(parts) {
    return Boolean(
      parts.dialog &&
      parts.dock &&
      parts.dialog.classList.contains("isCollapsed") &&
      isActuallyVisible(parts.openButton) &&
      !isActuallyVisible(parts.closeButton)
    );
  }

  function waitForValue(getValue, timeoutMs) {
    const initialValue = getValue();
    if (initialValue) return Promise.resolve(initialValue);

    return new Promise((resolve) => {
      let settled = false;
      const root = document.documentElement;
      let observer;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearTimeout(timeoutId);
        resolve(value);
      };

      const check = () => {
        const value = getValue();
        if (value) finish(value);
      };

      const timeoutId = setTimeout(() => finish(null), timeoutMs);
      if (root) {
        observer = new MutationObserver(check);
        observer.observe(root, {
          attributes: true,
          attributeFilter: ["class", "hidden", "style", "aria-hidden"],
          childList: true,
          subtree: true
        });
      }

      check();
    });
  }

  function showFailureNotice() {
    const message = "Dockを開けませんでした。通常のページを表示しています。";
    let notice = document.getElementById("ywm-dock-notice");

    if (!notice) {
      notice = document.createElement("div");
      notice.id = "ywm-dock-notice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.append(notice);
    }

    notice.textContent = message;
    window.setTimeout(() => notice?.remove(), 9000);
  }

  function reportReadyAfterLayout() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          chrome.runtime.sendMessage({ type: "YWM_DOCK_READY" }).catch(() => undefined);
        } catch {
          // 拡張機能の再読み込み中でも、Dock表示自体は維持します。
        }
      });
    });
  }

  async function prepareDock(generation, expectedRouteKey) {
    const isCurrentTarget = () => generation === routeGeneration &&
      getWatchlistRouteKey() === expectedRouteKey;

    const initialState = await waitForValue(() => {
      const parts = findDockParts();
      if (isOpen(parts)) return { state: "open", parts };
      if (isClosed(parts)) return { state: "closed", parts };
      return null;
    }, FIRST_WAIT_MS);

    if (!isCurrentTarget()) return;
    if (!initialState) {
      showFailureNotice();
      return;
    }

    if (initialState.state === "closed") {
      if (!isCurrentTarget()) return;
      initialState.parts.openButton.click();
      const opened = await waitForValue(() => {
        const parts = findDockParts();
        return isOpen(parts) ? parts : null;
      }, OPEN_WAIT_MS);

      if (!isCurrentTarget()) return;
      if (!opened) {
        showFailureNotice();
        return;
      }
    }

    if (!isCurrentTarget()) return;
    document.documentElement.classList.add(COMPACT_CLASS);
    reportReadyAfterLayout();
  }

  function startPreparation(generation) {
    const expectedRouteKey = routeKey;
    prepareDock(generation, expectedRouteKey).catch((error) => {
      if (generation !== routeGeneration || getWatchlistRouteKey() !== expectedRouteKey) return;
      console.warn("Watchlist Dockの準備に失敗しました。", error);
      showFailureNotice();
    });
  }

  function checkRoute() {
    const nextRouteKey = getWatchlistRouteKey();
    if (nextRouteKey === routeKey) return;

    const wasCompact = document.documentElement.classList.contains(COMPACT_CLASS);
    routeKey = nextRouteKey;
    routeGeneration += 1;
    document.getElementById("ywm-dock-notice")?.remove();

    if (routeKey && !wasCompact) {
      startPreparation(routeGeneration);
    } else {
      document.documentElement.classList.remove(COMPACT_CLASS);
    }
  }

  const routeObserver = new MutationObserver(checkRoute);
  routeObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", checkRoute);
  window.addEventListener("hashchange", checkRoute);

  for (const methodName of ["pushState", "replaceState"]) {
    const originalMethod = history[methodName];
    if (typeof originalMethod !== "function") continue;
    try {
      history[methodName] = function (...args) {
        const result = originalMethod.apply(this, args);
        queueMicrotask(checkRoute);
        return result;
      };
    } catch {
      // MutationObserverとpopstateでもURL変更を確認します。
    }
  }

  startPreparation(routeGeneration);
})();

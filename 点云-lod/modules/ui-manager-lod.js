import { CONFIG } from "./config.js";

export function createUIManager(dom) {
  let currentFps = 0;
  let frameCount = 0;
  let lastFpsTime = performance.now();
  let lastUiUpdateTime = 0;
  const UI_UPDATE_INTERVAL = 100; // UI更新间隔(ms)

  function updateFPS() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      currentFps = frameCount;
      frameCount = 0;
      lastFpsTime = now;
    }
    return now;
  }

  function shouldUpdateUI(now) {
    if (now - lastUiUpdateTime >= UI_UPDATE_INTERVAL) {
      lastUiUpdateTime = now;
      return true;
    }
    return false;
  }

  function update(octree, selectionCount, renderedPoints, totalPoints) {
    dom.infoTotal.textContent = totalPoints.toLocaleString();
    dom.infoVisibleNodes.textContent = octree.visibleNodes.length;
    dom.infoTotalNodes.textContent = octree.allNodes.length;
    dom.infoRendered.textContent = renderedPoints.toLocaleString();
    dom.infoBudget.textContent = (CONFIG.pointBudget / 1_000_000).toFixed(1) + "M";
    dom.infoLoaded.textContent = octree.loadedNodes.length;
    dom.infoMemory.textContent = octree.getMemoryUsage().toFixed(1);
    dom.infoSelected.textContent = selectionCount.toLocaleString();
    dom.infoFps.textContent = currentFps;
  }

  return {
    updateFPS,
    shouldUpdateUI,
    update
  };
}

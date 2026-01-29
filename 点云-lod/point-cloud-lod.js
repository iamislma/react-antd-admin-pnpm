import * as THREE from "three";
import { getDom } from "./modules/dom-lod.js";
import { createThreeContext } from "./modules/three-setup-lod.js";
import { CONFIG } from "./modules/config.js";
import { PointCloudOctree } from "./modules/point-cloud-octree.js";
import { createSelectionManager } from "./modules/selection-manager-lod.js";
import { createOctreeHelper } from "./modules/octree-helper.js";
import { createUIManager } from "./modules/ui-manager-lod.js";

// ============== DOM ==============
const dom = getDom();

// ============== Three.js 基础 ==============
const { renderer, scene, camera, controls } = createThreeContext(dom.canvas);

// ============== 状态 ==============
let octree = null;
let totalPoints = Number(dom.totalPointsSelect.value);
let selectMode = true;
let freezeLod = false;
let isSelecting = false;
let startX = 0, startY = 0;
let canvasRect = null;
let lastRenderedPoints = 0;

// ============== 管理器 ==============
const octreeHelper = createOctreeHelper(scene);
const uiManager = createUIManager(dom);

let selectionManager = null;

// ============== 初始化八叉树 ==============
function initOctree() {
  if (octree) {
    octree.dispose();
  }

  totalPoints = Number(dom.totalPointsSelect.value);
  CONFIG.pointBudget = Number(dom.budgetSlider.value);
  CONFIG.sseThreshold = Number(dom.sseSlider.value);

  octree = new PointCloudOctree(totalPoints, CONFIG.worldSize, CONFIG.maxDepth, scene);
  
  // 创建选择管理器
  selectionManager = createSelectionManager({ 
    scene, 
    octree, 
    camera, 
    renderer 
  });
}

// ============== UI 事件 ==============
dom.budgetSlider.addEventListener("input", () => {
  CONFIG.pointBudget = Number(dom.budgetSlider.value);
  dom.budgetValue.textContent = (CONFIG.pointBudget / 1_000_000).toFixed(1) + "万";
});

dom.sseSlider.addEventListener("input", () => {
  CONFIG.sseThreshold = Number(dom.sseSlider.value);
  dom.sseValue.textContent = CONFIG.sseThreshold.toFixed(1);
});

dom.selectToggleBtn.addEventListener("click", () => {
  selectMode = !selectMode;
  dom.selectToggleBtn.classList.toggle("active", selectMode);
  dom.selectToggleBtn.textContent = `框选：${selectMode ? "开" : "关"}`;
});

dom.clearSelectionBtn.addEventListener("click", () => {
  if (selectionManager) {
    selectionManager.clearSelection();
  }
});

dom.showOctreeToggleBtn.addEventListener("click", () => {
  const isVisible = octreeHelper.toggle();
  dom.showOctreeToggleBtn.classList.toggle("active", isVisible);
  dom.showOctreeToggleBtn.textContent = isVisible ? "隐藏八叉树" : "显示八叉树";
});

dom.freezeLodToggleBtn.addEventListener("click", () => {
  freezeLod = !freezeLod;
  dom.freezeLodToggleBtn.classList.toggle("active", freezeLod);
  dom.freezeLodToggleBtn.textContent = freezeLod ? "解冻LOD" : "冻结LOD";
});

dom.rebuildBtn.addEventListener("click", initOctree);

// ============== 框选事件 ==============
function onPointerDown(event) {
  if (!selectMode || event.button !== 0) return;

  isSelecting = true;
  controls.enabled = false;
  canvasRect = renderer.domElement.getBoundingClientRect();
  startX = event.clientX - canvasRect.left;
  startY = event.clientY - canvasRect.top;
  dom.selectRect.style.display = "block";
  dom.selectRect.style.left = `${canvasRect.left + startX}px`;
  dom.selectRect.style.top = `${canvasRect.top + startY}px`;
  dom.selectRect.style.width = "0px";
  dom.selectRect.style.height = "0px";
}

function onPointerMove(event) {
  if (!isSelecting) return;
  const currentX = event.clientX - canvasRect.left;
  const currentY = event.clientY - canvasRect.top;
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  dom.selectRect.style.left = `${canvasRect.left + left}px`;
  dom.selectRect.style.top = `${canvasRect.top + top}px`;
  dom.selectRect.style.width = `${width}px`;
  dom.selectRect.style.height = `${height}px`;
}

function onPointerUp(event) {
  if (!isSelecting) return;
  isSelecting = false;
  controls.enabled = true;
  dom.selectRect.style.display = "none";

  const endX = event.clientX - canvasRect.left;
  const endY = event.clientY - canvasRect.top;
  const rect = {
    left: Math.min(startX, endX),
    right: Math.max(startX, endX),
    top: Math.min(startY, endY),
    bottom: Math.max(startY, endY)
  };

  if (rect.right - rect.left < 4 || rect.bottom - rect.top < 4) return;

  if (selectionManager) {
    setTimeout(() => selectionManager.selectPointsInRect(rect), 0);
  }
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

// ============== 窗口大小 ==============
function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
window.addEventListener("resize", onResize);

// ============== 主循环 ==============
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  // FPS 计算
  const now = uiManager.updateFPS();

  // LOD 更新
  let renderedPoints = 0;
  if (octree && !freezeLod) {
    renderedPoints = octree.update(
      camera,
      renderer.domElement.clientHeight,
      CONFIG.sseThreshold,
      CONFIG.pointBudget
    );
    lastRenderedPoints = renderedPoints;
  } else if (octree) {
    // 冻结模式：只统计已渲染点数
    renderedPoints = octree.visibleNodes.reduce((sum, n) => sum + n.nodePointCount, 0);
    lastRenderedPoints = renderedPoints;
  }

  // 更新八叉树可视化
  if (octreeHelper.isVisible && octree) {
    octreeHelper.update(octree);
  }

  renderer.render(scene, camera);

  // 更新 UI (基于时间间隔，避免闪烁)
  if (uiManager.shouldUpdateUI(now) && octree && selectionManager) {
    uiManager.update(octree, selectionManager.selectionCount, lastRenderedPoints, totalPoints);
  }
}

// ============== 启动 ==============
dom.budgetValue.textContent = (CONFIG.pointBudget / 1_000_000).toFixed(1) + "万";
dom.sseValue.textContent = CONFIG.sseThreshold.toFixed(1);
initOctree();
animate();

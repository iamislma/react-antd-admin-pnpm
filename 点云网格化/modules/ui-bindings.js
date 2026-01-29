/**
 * UI 事件绑定管理器
 * 处理所有 UI 控件的事件绑定和交互
 */

import * as dom from './dom-mesh.js';
import { SHAPES } from './shapes-config.js';

/**
 * 创建形态选择按钮
 * @param {string} currentShape - 当前选中的形态
 * @param {Function} onShapeChange - 形态变化回调
 */
export function createShapeButtons(currentShape, onShapeChange) {
  Object.entries(SHAPES).forEach(([key, shape]) => {
    const btn = document.createElement("button");
    btn.className = "shape-btn" + (key === currentShape ? " active" : "");
    btn.textContent = shape.icon + " " + shape.name;
    btn.dataset.shape = key;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".shape-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      onShapeChange(key);
    });
    dom.shapeButtonsContainer.appendChild(btn);
  });
}

/**
 * 绑定点云控制滑块事件
 * @param {Object} state - 应用状态
 * @param {Object} uniforms - TSL uniform 节点
 * @param {Function} onRebuild - 重建点云回调
 */
export function bindPointCloudControls(state, uniforms, onRebuild) {
  // 点数量滑块
  dom.countSlider.addEventListener("input", () => {
    state.pointCount = Number(dom.countSlider.value);
    dom.countValue.textContent = (state.pointCount / 10000).toFixed(0) + "万";
  });
  dom.countSlider.addEventListener("change", onRebuild);

  // 点大小滑块
  dom.sizeSlider.addEventListener("input", () => {
    state.pointSize = Number(dom.sizeSlider.value);
    dom.sizeValue.textContent = state.pointSize.toFixed(1);
    uniforms.uSize.value = state.pointSize;
  });

  // 动画速度滑块
  dom.speedSlider.addEventListener("input", () => {
    state.animSpeed = Number(dom.speedSlider.value);
    dom.speedValue.textContent = state.animSpeed.toFixed(1);
    uniforms.uAnimSpeed.value = state.animSpeed;
  });

  // 颜色方案选择
  dom.colorSelect.addEventListener("change", () => {
    state.colorScheme = dom.colorSelect.selectedIndex;
    uniforms.uColorScheme.value = state.colorScheme;
  });
}

/**
 * 绑定网格重建控制事件
 * @param {Object} state - 应用状态
 * @param {Object} callbacks - 回调函数集合
 */
export function bindMeshControls(state, callbacks) {
  const { onMeshToggle, onRebuildMesh, onMeshParamChange } = callbacks;

  // 网格开关按钮
  dom.meshToggle.addEventListener("click", function () {
    state.meshEnabled = !state.meshEnabled;
    this.classList.toggle("active", state.meshEnabled);
    this.textContent = `网格：${state.meshEnabled ? "开" : "关"}`;
    onMeshToggle(state.meshEnabled);
  });

  // 重建网格按钮
  dom.rebuildMeshBtn.addEventListener("click", () => {
    if (state.meshEnabled) {
      onRebuildMesh();
    }
  });

  // 网格分辨率滑块
  dom.gridResSlider.addEventListener("input", () => {
    state.gridResolution = Number(dom.gridResSlider.value);
    dom.gridResValue.textContent = state.gridResolution;
  });
  dom.gridResSlider.addEventListener("change", () => {
    if (state.meshEnabled) onMeshParamChange();
  });

  // ISO 值滑块
  dom.isoValueSlider.addEventListener("input", () => {
    state.meshParams.isoValue = Number(dom.isoValueSlider.value);
    dom.isoValueValue.textContent = state.meshParams.isoValue.toFixed(2);
  });
  dom.isoValueSlider.addEventListener("change", () => {
    if (state.meshEnabled) onMeshParamChange();
  });

  // Splat 半径滑块
  dom.splatRadiusSlider.addEventListener("input", () => {
    state.meshParams.splatRadius = Number(dom.splatRadiusSlider.value);
    dom.splatRadiusValue.textContent = state.meshParams.splatRadius.toFixed(1);
  });
  dom.splatRadiusSlider.addEventListener("change", () => {
    if (state.meshEnabled) onMeshParamChange();
  });

  // 网格透明度滑块
  dom.meshOpacitySlider.addEventListener("input", () => {
    state.meshParams.meshOpacity = Number(dom.meshOpacitySlider.value);
    dom.meshOpacityValue.textContent = state.meshParams.meshOpacity.toFixed(1);
    callbacks.onOpacityChange?.(state.meshParams.meshOpacity);
  });
}

/**
 * 初始化 UI 显示值
 * @param {Object} state - 应用状态
 */
export function initUIValues(state) {
  dom.countValue.textContent = (state.pointCount / 10000).toFixed(0) + "万";
  dom.sizeValue.textContent = state.pointSize.toFixed(1);
  dom.speedValue.textContent = state.animSpeed.toFixed(1);
  dom.gridResValue.textContent = state.gridResolution;
  dom.isoValueValue.textContent = state.meshParams.isoValue.toFixed(2);
  dom.splatRadiusValue.textContent = state.meshParams.splatRadius.toFixed(1);
  dom.meshOpacityValue.textContent = state.meshParams.meshOpacity.toFixed(1);
}

/**
 * 更新信息面板
 * @param {Object} info - 信息数据
 */
export function updateInfoPanel(info) {
  if (dom.infoShape) dom.infoShape.textContent = info.shapeName || "";
  if (dom.infoCount) dom.infoCount.textContent = info.pointCount?.toLocaleString() || "";
  if (dom.infoGenTime) dom.infoGenTime.textContent = info.genTime?.toFixed(1) || "";
  if (dom.infoRenderMode) dom.infoRenderMode.textContent = info.renderMode || "";
  if (dom.infoFps) dom.infoFps.textContent = info.fps || "";
  if (dom.infoDrawCalls) dom.infoDrawCalls.textContent = info.drawCalls || "";
}

/**
 * 更新网格信息
 * @param {Object} meshInfo - 网格信息
 */
export function updateMeshInfo(meshInfo) {
  if (dom.infoMesh) dom.infoMesh.textContent = meshInfo.status || "";
  if (dom.infoTriangles) dom.infoTriangles.textContent = meshInfo.triangleCount?.toLocaleString() || "";
  if (dom.infoComputeTime) dom.infoComputeTime.textContent = meshInfo.computeTime ? `${meshInfo.computeTime.toFixed(1)} ms` : "";
}

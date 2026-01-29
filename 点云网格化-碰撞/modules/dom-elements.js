/**
 * DOM 元素引用模块
 * 
 * 管理所有 UI 控制元素的引用
 */

// ==================== 地形参数控件 ====================
export const countSlider = document.getElementById("countSlider");
export const countValue = document.getElementById("countValue");
export const sizeSlider = document.getElementById("sizeSlider");
export const sizeValue = document.getElementById("sizeValue");
export const speedSlider = document.getElementById("speedSlider");
export const speedValue = document.getElementById("speedValue");
export const colorSelect = document.getElementById("colorScheme");

// ==================== 网格重建控件 ====================
export const meshToggleBtn = document.getElementById("meshToggle");
export const rebuildMeshBtn = document.getElementById("rebuildMesh");
export const gridResSlider = document.getElementById("gridResSlider");
export const gridResValue = document.getElementById("gridResValue");
export const isoValueSlider = document.getElementById("isoValueSlider");
export const isoValueValue = document.getElementById("isoValueValue");
export const splatRadiusSlider = document.getElementById("splatRadiusSlider");
export const splatRadiusValue = document.getElementById("splatRadiusValue");
export const meshOpacitySlider = document.getElementById("meshOpacitySlider");
export const meshOpacityValue = document.getElementById("meshOpacityValue");

// ==================== 球体物理参数控件 ====================
export const resetBallBtn = document.getElementById("resetBall");
export const ballForceSlider = document.getElementById("ballForceSlider");
export const ballForceValue = document.getElementById("ballForceValue");
export const ballJumpSlider = document.getElementById("ballJumpSlider");
export const ballJumpValue = document.getElementById("ballJumpValue");
export const ballDampingSlider = document.getElementById("ballDampingSlider");
export const ballDampingValue = document.getElementById("ballDampingValue");
export const ballAirSlider = document.getElementById("ballAirSlider");
export const ballAirValue = document.getElementById("ballAirValue");
export const ballFrictionSlider = document.getElementById("ballFrictionSlider");
export const ballFrictionValue = document.getElementById("ballFrictionValue");
export const ballRestitutionSlider = document.getElementById("ballRestitutionSlider");
export const ballRestitutionValue = document.getElementById("ballRestitutionValue");

// ==================== 信息显示元素 ====================
export const infoShape = document.getElementById("infoShape");
export const infoCount = document.getElementById("infoCount");
export const infoGenTime = document.getElementById("infoGenTime");
export const infoRenderMode = document.getElementById("infoRenderMode");
export const infoMesh = document.getElementById("infoMesh");
export const infoTriangles = document.getElementById("infoTriangles");
export const infoFps = document.getElementById("infoFps");
export const infoDrawCalls = document.getElementById("infoDrawCalls");
export const infoComputeTime = document.getElementById("infoComputeTime");
export const infoPhysics = document.getElementById("infoPhysics");
export const infoActiveChunks = document.getElementById("infoActiveChunks");
export const infoBallPos = document.getElementById("infoBallPos");

// ==================== Canvas ====================
export const canvas = document.getElementById("canvas");

// ==================== WebGPU 状态提示 ====================
export const webgpuStatus = document.getElementById("webgpu-status");

/**
 * 更新信息面板显示
 * @param {Object} data - 信息数据
 */
export function updateInfoDisplay(data) {
  if (data.shapeName !== undefined && infoShape) {
    infoShape.textContent = data.shapeName;
  }
  if (data.pointCount !== undefined && infoCount) {
    infoCount.textContent = data.pointCount.toLocaleString();
  }
  if (data.genTime !== undefined && infoGenTime) {
    infoGenTime.textContent = data.genTime.toFixed(1);
  }
  if (data.renderMode !== undefined && infoRenderMode) {
    infoRenderMode.textContent = data.renderMode;
  }
  if (data.meshStatus !== undefined && infoMesh) {
    infoMesh.textContent = data.meshStatus;
  }
  if (data.triangleCount !== undefined && infoTriangles) {
    infoTriangles.textContent = data.triangleCount.toLocaleString();
  }
  if (data.fps !== undefined && infoFps) {
    infoFps.textContent = data.fps;
  }
  if (data.drawCalls !== undefined && infoDrawCalls) {
    infoDrawCalls.textContent = data.drawCalls;
  }
  if (data.computeTime !== undefined && infoComputeTime) {
    infoComputeTime.textContent = data.computeTime + " ms";
  }
  if (data.physicsStatus !== undefined && infoPhysics) {
    infoPhysics.textContent = data.physicsStatus;
  }
  if (data.activeChunks !== undefined && infoActiveChunks) {
    infoActiveChunks.textContent = data.activeChunks;
  }
  if (data.ballPosition !== undefined && infoBallPos) {
    const p = data.ballPosition;
    infoBallPos.textContent = `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
  }
}

/**
 * 初始化 UI 默认值显示
 * @param {Object} config - 配置对象
 */
export function initUIValues(config) {
  if (countValue) countValue.textContent = (config.pointCount / 10000).toFixed(0) + "万";
  if (sizeValue) sizeValue.textContent = config.pointSize.toFixed(1);
  if (speedValue) speedValue.textContent = config.animSpeed.toFixed(1);
  if (gridResValue) gridResValue.textContent = config.gridResolution;
  if (isoValueValue) isoValueValue.textContent = config.meshParams.isoValue.toFixed(2);
  if (splatRadiusValue) splatRadiusValue.textContent = config.meshParams.splatRadius.toFixed(1);
  if (meshOpacityValue) meshOpacityValue.textContent = config.meshParams.meshOpacity.toFixed(1);
  
  // 设置颜色方案下拉框
  if (colorSelect) colorSelect.selectedIndex = config.colorScheme;
}

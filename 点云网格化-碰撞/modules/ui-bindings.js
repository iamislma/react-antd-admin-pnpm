/**
 * UI 事件绑定模块
 * 
 * 管理所有 UI 控件的事件监听和回调
 */

import * as DOM from './dom-elements.js';

/**
 * 设置所有 UI 事件绑定
 * @param {Object} callbacks - 回调函数集合
 * @param {Object} state - 应用状态
 * @param {Object} uniforms - TSL uniforms 对象
 */
export function setupUIBindings(callbacks, state, uniforms) {
  // ==================== 地形参数 ====================
  if (DOM.countSlider) {
    DOM.countSlider.addEventListener("input", () => {
      state.pointCount = Number(DOM.countSlider.value);
      DOM.countValue.textContent = (state.pointCount / 10000).toFixed(0) + "万";
    });
    DOM.countSlider.addEventListener("change", () => {
      if (callbacks.onPointCountChange) callbacks.onPointCountChange();
    });
  }

  if (DOM.sizeSlider) {
    DOM.sizeSlider.addEventListener("input", () => {
      state.pointSize = Number(DOM.sizeSlider.value);
      DOM.sizeValue.textContent = state.pointSize.toFixed(1);
      if (uniforms.uSize) uniforms.uSize.value = state.pointSize;
    });
  }

  if (DOM.speedSlider) {
    DOM.speedSlider.addEventListener("input", () => {
      state.animSpeed = Number(DOM.speedSlider.value);
      DOM.speedValue.textContent = state.animSpeed.toFixed(1);
      if (uniforms.uAnimSpeed) uniforms.uAnimSpeed.value = state.animSpeed;
    });
  }

  if (DOM.colorSelect) {
    DOM.colorSelect.addEventListener("change", () => {
      state.colorScheme = DOM.colorSelect.selectedIndex;
      if (uniforms.uColorScheme) uniforms.uColorScheme.value = state.colorScheme;
    });
  }

  // ==================== 网格重建 ====================
  if (DOM.meshToggleBtn) {
    DOM.meshToggleBtn.addEventListener("click", function() {
      state.meshEnabled = !state.meshEnabled;
      this.classList.toggle("active", state.meshEnabled);
      this.textContent = `网格：${state.meshEnabled ? "开" : "关"}`;
      
      if (callbacks.onMeshToggle) callbacks.onMeshToggle(state.meshEnabled);
    });
  }

  if (DOM.rebuildMeshBtn) {
    DOM.rebuildMeshBtn.addEventListener("click", () => {
      if (callbacks.onRebuildMesh) callbacks.onRebuildMesh();
    });
  }

  if (DOM.gridResSlider) {
    DOM.gridResSlider.addEventListener("input", () => {
      state.gridResolution = Number(DOM.gridResSlider.value);
      DOM.gridResValue.textContent = state.gridResolution;
    });
    DOM.gridResSlider.addEventListener("change", () => {
      if (callbacks.onGridResChange) callbacks.onGridResChange();
    });
  }

  if (DOM.isoValueSlider) {
    DOM.isoValueSlider.addEventListener("input", () => {
      state.meshParams.isoValue = Number(DOM.isoValueSlider.value);
      DOM.isoValueValue.textContent = state.meshParams.isoValue.toFixed(2);
    });
    DOM.isoValueSlider.addEventListener("change", () => {
      if (callbacks.onMeshParamChange) callbacks.onMeshParamChange();
    });
  }

  if (DOM.splatRadiusSlider) {
    DOM.splatRadiusSlider.addEventListener("input", () => {
      state.meshParams.splatRadius = Number(DOM.splatRadiusSlider.value);
      DOM.splatRadiusValue.textContent = state.meshParams.splatRadius.toFixed(1);
    });
    DOM.splatRadiusSlider.addEventListener("change", () => {
      if (callbacks.onMeshParamChange) callbacks.onMeshParamChange();
    });
  }

  if (DOM.meshOpacitySlider) {
    DOM.meshOpacitySlider.addEventListener("input", () => {
      state.meshParams.meshOpacity = Number(DOM.meshOpacitySlider.value);
      DOM.meshOpacityValue.textContent = state.meshParams.meshOpacity.toFixed(1);
      if (callbacks.onMeshOpacityChange) {
        callbacks.onMeshOpacityChange(state.meshParams.meshOpacity);
      }
    });
  }

  // ==================== 球体物理参数 ====================
  if (DOM.ballForceSlider) {
    DOM.ballForceSlider.addEventListener("input", () => {
      state.ballParams.force = Number(DOM.ballForceSlider.value);
      DOM.ballForceValue.textContent = state.ballParams.force;
      if (callbacks.onBallForceChange) {
        callbacks.onBallForceChange(state.ballParams.force);
      }
    });
  }

  if (DOM.ballJumpSlider) {
    DOM.ballJumpSlider.addEventListener("input", () => {
      state.ballParams.jumpForce = Number(DOM.ballJumpSlider.value);
      DOM.ballJumpValue.textContent = state.ballParams.jumpForce;
      if (callbacks.onBallJumpChange) {
        callbacks.onBallJumpChange(state.ballParams.jumpForce);
      }
    });
  }

  if (DOM.ballDampingSlider) {
    DOM.ballDampingSlider.addEventListener("input", () => {
      state.ballParams.damping = Number(DOM.ballDampingSlider.value);
      DOM.ballDampingValue.textContent = state.ballParams.damping.toFixed(2);
      if (callbacks.onBallDampingChange) {
        callbacks.onBallDampingChange(state.ballParams.damping);
      }
    });
  }

  if (DOM.ballAirSlider) {
    DOM.ballAirSlider.addEventListener("input", () => {
      state.ballParams.airControl = Number(DOM.ballAirSlider.value);
      DOM.ballAirValue.textContent = state.ballParams.airControl.toFixed(2);
      if (callbacks.onBallAirControlChange) {
        callbacks.onBallAirControlChange(state.ballParams.airControl);
      }
    });
  }

  if (DOM.ballFrictionSlider) {
    DOM.ballFrictionSlider.addEventListener("input", () => {
      state.ballParams.friction = Number(DOM.ballFrictionSlider.value);
      DOM.ballFrictionValue.textContent = state.ballParams.friction.toFixed(2);
      if (callbacks.onBallFrictionChange) {
        callbacks.onBallFrictionChange(state.ballParams.friction);
      }
    });
  }

  if (DOM.ballRestitutionSlider) {
    DOM.ballRestitutionSlider.addEventListener("input", () => {
      state.ballParams.restitution = Number(DOM.ballRestitutionSlider.value);
      DOM.ballRestitutionValue.textContent = state.ballParams.restitution.toFixed(2);
      if (callbacks.onBallRestitutionChange) {
        callbacks.onBallRestitutionChange(state.ballParams.restitution);
      }
    });
  }

  if (DOM.resetBallBtn) {
    DOM.resetBallBtn.addEventListener("click", () => {
      if (callbacks.onResetBall) callbacks.onResetBall();
    });
  }
}

/**
 * 设置网格切换按钮初始状态
 * @param {boolean} enabled - 是否启用
 */
export function setMeshToggleState(enabled) {
  if (DOM.meshToggleBtn) {
    DOM.meshToggleBtn.classList.toggle("active", enabled);
    DOM.meshToggleBtn.textContent = `网格：${enabled ? "开" : "关"}`;
  }
}

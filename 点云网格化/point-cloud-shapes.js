/**
 * 点云网格化主控制器
 * 整合 WebGPU 渲染、TSL 点云生成和 Marching Cubes 网格重建
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { SHAPES, getShapeIndex, DEFAULT_CONFIG } from './modules/shapes-config.js';
import { uTime, uSize, uAnimSpeed, uShape, uColorScheme, createPointCloudMaterial } from './modules/tsl-generators.js';
import { MeshReconstructor } from './modules/mesh-reconstructor.js';
import { generatePointCloudData } from './modules/point-cloud-cpu.js';
import { canvas } from './modules/dom-mesh.js';
import * as ui from './modules/ui-bindings.js';

// ==================== 应用状态 ====================
const state = {
  currentShape: DEFAULT_CONFIG.currentShape,
  pointCount: DEFAULT_CONFIG.pointCount,
  pointSize: DEFAULT_CONFIG.pointSize,
  animSpeed: DEFAULT_CONFIG.animSpeed,
  colorScheme: DEFAULT_CONFIG.colorScheme,
  meshEnabled: DEFAULT_CONFIG.mesh.enabled,
  gridResolution: DEFAULT_CONFIG.mesh.gridResolution,
  meshParams: {
    isoValue: DEFAULT_CONFIG.mesh.isoValue,
    splatRadius: DEFAULT_CONFIG.mesh.splatRadius,
    meshOpacity: DEFAULT_CONFIG.mesh.meshOpacity,
  }
};

// ==================== Three.js 对象 ====================
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let points = null;
let material = null;
let geometry = null;
let reconstructedMesh = null;
let meshReconstructor = null;

// ==================== 性能统计 ====================
let genTime = 0;
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;
let lastUiUpdate = 0;
let time = 0;

// ==================== 点云创建 ====================
function rebuildPointCloud() {
  if (!scene) return;

  // 清理旧的
  if (points) {
    scene.remove(points);
    geometry.dispose();
    material.dispose();
  }

  const startTime = performance.now();

  geometry = new THREE.BufferGeometry();

  // 准备顶点属性数据
  const basePositions = new Float32Array(state.pointCount * 3);
  const randoms = new Float32Array(state.pointCount);

  for (let i = 0; i < state.pointCount; i++) {
    basePositions[i * 3] = Math.random();
    basePositions[i * 3 + 1] = Math.random();
    basePositions[i * 3 + 2] = Math.random();
    randoms[i] = Math.random();
  }

  // GPU 生成：传递随机种子，在着色器中计算位置
  geometry.setAttribute("position", new THREE.BufferAttribute(basePositions, 3));
  geometry.setAttribute("aBasePosition", new THREE.BufferAttribute(basePositions, 3));
  geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 1));

  // 更新 uniform 值
  uSize.value = state.pointSize;
  uAnimSpeed.value = state.animSpeed;
  uShape.value = getShapeIndex(state.currentShape);
  uColorScheme.value = state.colorScheme;

  // 创建材质
  material = createPointCloudMaterial(geometry, getShapeIndex(state.currentShape));

  points = new THREE.Points(geometry, material);
  scene.add(points);

  genTime = performance.now() - startTime;
}

// ==================== 网格重建 ====================
async function initMeshReconstructor() {
  if (!navigator.gpu) {
    console.warn("WebGPU not available for mesh reconstruction");
    ui.updateMeshInfo({ status: "不可用" });
    return false;
  }
  meshReconstructor = new MeshReconstructor();
  const success = await meshReconstructor.init();
  if (success) {
    ui.updateMeshInfo({ status: "已就绪" });
  } else {
    ui.updateMeshInfo({ status: "初始化失败" });
  }
  return success;
}

async function rebuildMesh() {
  if (!meshReconstructor || !meshReconstructor.initialized) {
    console.warn("MeshReconstructor not initialized");
    return;
  }

  ui.updateMeshInfo({ status: "重建中..." });

  try {
    // 生成点云位置和颜色
    const { positions, colors } = generatePointCloudData(
      state.currentShape, 
      state.pointCount, 
      state.colorScheme
    );

    // 设置参数
    meshReconstructor.params.isoValue = state.meshParams.isoValue;
    meshReconstructor.params.splatRadius = state.meshParams.splatRadius;

    // 准备点云数据
    meshReconstructor.setPointCloud(positions, colors, state.pointCount, state.gridResolution);

    // 执行重建
    const result = await meshReconstructor.reconstruct();

    if (!result || result.triangleCount === 0) {
      ui.updateMeshInfo({ status: "无三角形", triangleCount: 0 });
      clearMesh();
      return;
    }

    ui.updateMeshInfo({
      status: "已完成",
      triangleCount: result.triangleCount,
      computeTime: meshReconstructor.lastComputeTime
    });

    // 移除旧网格
    clearMesh();

    // 创建 Three.js 网格
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
    meshGeometry.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
    meshGeometry.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));

    const meshMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      transparent: true,
      opacity: state.meshParams.meshOpacity,
      metalness: 0.1,
      roughness: 0.4,
      side: THREE.DoubleSide,
      flatShading: false,
    });

    reconstructedMesh = new THREE.Mesh(meshGeometry, meshMaterial);
    scene.add(reconstructedMesh);

    console.log(`Mesh reconstructed: ${result.triangleCount} triangles in ${meshReconstructor.lastComputeTime.toFixed(1)}ms`);

  } catch (e) {
    console.error("Mesh reconstruction failed:", e);
    ui.updateMeshInfo({ status: "失败: " + e.message });
  }
}

function clearMesh() {
  if (reconstructedMesh) {
    scene.remove(reconstructedMesh);
    reconstructedMesh.geometry.dispose();
    reconstructedMesh.material.dispose();
    reconstructedMesh = null;
  }
}

// ==================== 事件处理 ====================
function handleShapeChange(shapeKey) {
  state.currentShape = shapeKey;
  uShape.value = getShapeIndex(shapeKey);
  rebuildPointCloud();
}

function handleMeshToggle(enabled) {
  if (enabled) {
    if (meshReconstructor && meshReconstructor.initialized) {
      rebuildMesh();
    } else {
      initMeshReconstructor().then(success => {
        if (success) rebuildMesh();
      });
    }
    // 隐藏点云
    if (points) points.visible = false;
  } else {
    clearMesh();
    // 显示点云
    if (points) points.visible = true;
  }
}

function handleOpacityChange(opacity) {
  if (reconstructedMesh) {
    reconstructedMesh.material.opacity = opacity;
  }
}

// ==================== 渲染循环 ====================
function render() {
  requestAnimationFrame(render);
  if (!renderer) return;

  const now = performance.now();

  // FPS 计算
  frameCount++;
  if (now - lastFpsTime >= 1000) {
    currentFps = frameCount;
    frameCount = 0;
    lastFpsTime = now;
  }

  // 更新动画时间
  time += 0.016;
  uTime.value = time;

  controls.update();
  renderer.renderAsync(scene, camera);

  // 更新 UI (每100ms)
  if (now - lastUiUpdate >= 100) {
    lastUiUpdate = now;
    ui.updateInfoPanel({
      shapeName: SHAPES[state.currentShape].name,
      pointCount: state.pointCount,
      genTime: genTime,
      renderMode: "GPU 着色器 (WebGPU)",
      fps: currentFps,
      drawCalls: renderer.info?.render?.calls ?? 0
    });
  }
}

// ==================== 窗口大小调整 ====================
function handleResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== 初始化 ====================
async function init() {
  // 检测 WebGPU 支持
  if (!navigator.gpu) {
    console.error("WebGPU is not supported in this browser");
    return;
  }

  // 创建 WebGPU 渲染器
  renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance"
  });

  // 等待 WebGPU 初始化完成
  await renderer.init();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0a0d12, 1);

  // 场景
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 50, 150);

  // 灯光 (用于网格渲染)
  const ambientLight = new THREE.AmbientLight(0x404050, 0.5);
  scene.add(ambientLight);

  const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight1.position.set(100, 100, 100);
  scene.add(directionalLight1);

  const directionalLight2 = new THREE.DirectionalLight(0x6080ff, 0.5);
  directionalLight2.position.set(-100, -50, -100);
  scene.add(directionalLight2);

  // 控制器
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.0;

  // 初始化 UI
  ui.initUIValues(state);
  ui.createShapeButtons(state.currentShape, handleShapeChange);
  ui.bindPointCloudControls(state, { uSize, uAnimSpeed, uColorScheme }, rebuildPointCloud);
  ui.bindMeshControls(state, {
    onMeshToggle: handleMeshToggle,
    onRebuildMesh: rebuildMesh,
    onMeshParamChange: rebuildMesh,
    onOpacityChange: handleOpacityChange
  });

  // 窗口大小调整
  window.addEventListener("resize", handleResize);

  // 初始化网格重建器 (后台)
  initMeshReconstructor();

  // 创建点云
  rebuildPointCloud();

  // 开始渲染循环
  render();

  console.log("Three.js WebGPU initialized successfully");
}

// 启动应用
init().catch(console.error);

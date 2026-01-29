/**
 * 地形物理应用主控制器
 * 
 * FBM+Perlin 地形点云渲染 + WebGPU Marching Cubes 网格重建 + Rapier3D 物理碰撞
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

// TSL 函数
const {
  attribute, uniform, varying, varyingProperty,
  vec2, vec3, vec4, float, int, mat2,
  add, sub, mul, div, mod, abs, sign, floor, ceil, fract, sqrt, pow, exp, log,
  sin, cos, tan, asin, acos, atan, atan2,
  min, max, clamp, mix, step, smoothstep,
  length, distance, dot, cross, normalize, reflect,
  positionLocal, positionWorld, modelViewMatrix, projectionMatrix,
  cameraPosition, modelWorldMatrix,
  Fn, If, Loop,
  hash,
} = THREE.TSL;

// 本地模块
import { uTime, uSize, uAnimSpeed, uShape, uColorScheme, generateTerrain, computeColor } from './tsl-terrain-generators.js';
import { MeshReconstructor } from './mesh-reconstructor.js';
import { generatePointsCPU, generatePointColors as generatePointColorsCPU } from './cpu-noise.js';
import { ChunkedTerrainCollider } from './chunked-terrain-collider.js';
import { PhysicsBall } from './physics-ball.js';
import * as DOM from './dom-elements.js';
import { initUIValues, updateInfoDisplay } from './dom-elements.js';
import { setupUIBindings, setMeshToggleState } from './ui-bindings.js';

// ==================== 应用状态 ====================
const state = {
  pointCount: 1000000,
  pointSize: 1.5,
  animSpeed: 0.5,
  colorScheme: 2, // 高度映射
  currentShape: 0,
  meshEnabled: true, // 默认开启网格
  gridResolution: 160,
  meshParams: {
    isoValue: 1.7,
    splatRadius: 3.0,
    meshOpacity: 0.9
  },
  ballParams: {
    force: 400,
    jumpForce: 250,
    damping: 0.3,
    airControl: 0.6,
    friction: 0.5,
    restitution: 0.4
  }
};

// SHAPES 配置 (只有地形形态)
const SHAPES = [
  { name: "FBM地形", id: 0 }
];

// ==================== Three.js 场景对象 ====================
let renderer, scene, camera, controls;
let geometry, material, points;
let reconstructedMesh = null;

// ==================== WebGPU 网格重建 ====================
let meshReconstructor = null;
let triangleCount = 0;
let computeTime = 0;

// ==================== 物理引擎 ====================
let physicsWorld = null;
let physicsInitialized = false;
let physicsBall = null;
let chunkedTerrain = null;

// ==================== 性能统计 ====================
let frameCount = 0;
let currentFps = 0;
let lastFpsTime = performance.now();
let lastUiUpdate = 0;
let genTime = 0;
let time = 0;

// ==================== 初始化物理引擎 ====================
async function initPhysics() {
  try {
    await RAPIER.init();
    
    const gravity = { x: 0.0, y: -30.0, z: 0.0 };
    physicsWorld = new RAPIER.World(gravity);
    
    physicsInitialized = true;
    
    if (DOM.infoPhysics) DOM.infoPhysics.textContent = "运行中";
    console.log("Rapier physics initialized");
    
    return true;
  } catch (error) {
    console.error("Failed to initialize physics:", error);
    if (DOM.infoPhysics) DOM.infoPhysics.textContent = "初始化失败";
    return false;
  }
}

// ==================== 创建物理球 ====================
function createBall() {
  if (!physicsWorld) return;
  
  physicsBall = new PhysicsBall(physicsWorld, RAPIER, scene, {
    radius: 2.5,
    startHeight: 100,
    force: state.ballParams.force,
    jumpForce: state.ballParams.jumpForce,
    damping: state.ballParams.damping,
    airControl: state.ballParams.airControl,
    friction: state.ballParams.friction,
    restitution: state.ballParams.restitution
  });
  
  physicsBall.create();
  console.log("Ball created at height 100");
}

// ==================== 构建地形碰撞 ====================
function buildTerrainCollision(meshPositions) {
  if (!physicsWorld) return;
  
  // 销毁旧的分块管理器
  if (chunkedTerrain) {
    chunkedTerrain.destroy();
  }
  
  // 创建新的分块管理器 (10x10 块)
  chunkedTerrain = new ChunkedTerrainCollider(physicsWorld, RAPIER, 10, 10);
  chunkedTerrain.buildFromMesh(meshPositions);
  
  // 立即激活球体附近的块
  if (physicsBall) {
    const pos = physicsBall.getPosition();
    chunkedTerrain.updateActiveChunks(pos.x, pos.z);
  }
  
  console.log("Terrain collision built with chunking");
}

// ==================== 物理步进 ====================
function stepPhysics() {
  if (!physicsWorld || !physicsInitialized) return;
  
  // 施加玩家控制力并步进物理
  if (physicsBall) {
    physicsBall.applyForces();
  }
  
  physicsWorld.step();
  
  // 同步球体位置
  if (physicsBall) {
    physicsBall.syncPosition();
    
    const pos = physicsBall.getPosition();
    
    // 更新活跃碰撞块
    if (chunkedTerrain) {
      const activeCount = chunkedTerrain.updateActiveChunks(pos.x, pos.z);
      if (DOM.infoActiveChunks) DOM.infoActiveChunks.textContent = activeCount;
    }
    
    // 检查边界重置
    physicsBall.checkBounds();
  }
}

// ==================== 创建点云 ====================
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
  
  geometry.setAttribute("position", new THREE.BufferAttribute(basePositions, 3));
  geometry.setAttribute("aBasePosition", new THREE.BufferAttribute(basePositions, 3));
  geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 1));
  
  // 更新 uniform 值
  uSize.value = state.pointSize;
  uAnimSpeed.value = state.animSpeed;
  uShape.value = 0;
  uColorScheme.value = state.colorScheme;
  
  // 获取顶点属性节点
  const aBasePosition = attribute("aBasePosition", "vec3");
  
  // 地形生成
  const finalPos = generateTerrain(aBasePosition);
  
  // 颜色节点
  const colorResult = computeColor(finalPos, uColorScheme.toFloat());
  
  // 点大小节点 - 距离衰减
  const mvPosition = modelViewMatrix.mul(vec4(finalPos, 1.0));
  const dist = mvPosition.z.negate();
  const size = uSize.mul(float(300.0).div(dist)).clamp(1.0, 50.0);
  
  // 创建 PointsNodeMaterial
  material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false,
  });
  
  material.positionNode = finalPos;
  material.colorNode = vec4(colorResult, 1.0);
  material.sizeNode = size;
  
  points = new THREE.Points(geometry, material);
  scene.add(points);
  
  genTime = performance.now() - startTime;
}

// ==================== 网格重建 ====================
async function initMeshReconstructor() {
  if (!navigator.gpu) {
    console.warn("WebGPU not available for mesh reconstruction");
    if (DOM.infoMesh) DOM.infoMesh.textContent = "不可用";
    return false;
  }
  
  meshReconstructor = new MeshReconstructor();
  const success = await meshReconstructor.init();
  
  if (success) {
    if (DOM.infoMesh) DOM.infoMesh.textContent = "已就绪";
  } else {
    if (DOM.infoMesh) DOM.infoMesh.textContent = "初始化失败";
  }
  
  return success;
}

function generateMeshPointColors() {
  // 从当前点云生成对应的颜色数据
  const positions = generatePointsCPU(state.currentShape, state.pointCount);
  const colors = generatePointColorsCPU(positions, state.colorScheme);
  return { positions, colors };
}

async function rebuildMesh() {
  if (!meshReconstructor || !meshReconstructor.initialized) {
    console.warn("MeshReconstructor not initialized");
    return;
  }
  
  if (DOM.infoMesh) DOM.infoMesh.textContent = "重建中...";
  
  try {
    const { positions, colors } = generateMeshPointColors();
    
    // 设置参数
    meshReconstructor.params.isoValue = state.meshParams.isoValue;
    meshReconstructor.params.splatRadius = state.meshParams.splatRadius;
    
    // 准备点云数据
    meshReconstructor.setPointCloud(positions, colors, state.pointCount, state.gridResolution);
    
    // 执行重建
    const result = await meshReconstructor.reconstruct();
    
    if (!result || result.triangleCount === 0) {
      if (DOM.infoMesh) DOM.infoMesh.textContent = "无三角形";
      if (DOM.infoTriangles) DOM.infoTriangles.textContent = "0";
      clearMesh();
      return;
    }
    
    triangleCount = result.triangleCount;
    computeTime = meshReconstructor.lastComputeTime;
    
    if (DOM.infoMesh) DOM.infoMesh.textContent = "已完成";
    if (DOM.infoTriangles) DOM.infoTriangles.textContent = triangleCount.toLocaleString();
    if (DOM.infoComputeTime) DOM.infoComputeTime.textContent = computeTime.toFixed(1) + " ms";
    
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
      roughness: 0.6,
      side: THREE.DoubleSide
    });
    
    reconstructedMesh = new THREE.Mesh(meshGeometry, meshMaterial);
    reconstructedMesh.receiveShadow = true;
    scene.add(reconstructedMesh);
    
    // 构建物理碰撞
    buildTerrainCollision(result.positions);
    
  } catch (error) {
    console.error("Mesh reconstruction error:", error);
    if (DOM.infoMesh) DOM.infoMesh.textContent = "重建失败";
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

// ==================== UI 回调函数 ====================
const uiCallbacks = {
  onPointCountChange: rebuildPointCloud,
  
  onMeshToggle: async (enabled) => {
    if (enabled) {
      if (meshReconstructor && meshReconstructor.initialized) {
        rebuildMesh();
      } else {
        const success = await initMeshReconstructor();
        if (success) rebuildMesh();
      }
      if (points) points.visible = false;
    } else {
      clearMesh();
      if (points) points.visible = true;
    }
  },
  
  onRebuildMesh: () => {
    if (state.meshEnabled && meshReconstructor && meshReconstructor.initialized) {
      rebuildMesh();
    }
  },
  
  onGridResChange: () => {
    if (state.meshEnabled && meshReconstructor && meshReconstructor.initialized) {
      rebuildMesh();
    }
  },
  
  onMeshParamChange: () => {
    if (state.meshEnabled && meshReconstructor && meshReconstructor.initialized) {
      rebuildMesh();
    }
  },
  
  onMeshOpacityChange: (opacity) => {
    if (reconstructedMesh) {
      reconstructedMesh.material.opacity = opacity;
    }
  },
  
  onBallForceChange: (force) => {
    if (physicsBall) physicsBall.params.force = force;
  },
  
  onBallJumpChange: (jumpForce) => {
    if (physicsBall) physicsBall.params.jumpForce = jumpForce;
  },
  
  onBallDampingChange: (damping) => {
    if (physicsBall) physicsBall.setDamping(damping);
  },
  
  onBallAirControlChange: (airControl) => {
    if (physicsBall) physicsBall.params.airControl = airControl;
  },
  
  onBallFrictionChange: (friction) => {
    if (physicsBall) physicsBall.setFriction(friction);
  },
  
  onBallRestitutionChange: (restitution) => {
    if (physicsBall) physicsBall.setRestitution(restitution);
  },
  
  onResetBall: () => {
    if (physicsBall) physicsBall.reset();
  }
};

// ==================== 主渲染循环 ====================
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
  
  // 更新动画
  time += 0.016;
  uTime.value = time;
  
  // 物理步进
  stepPhysics();
  
  controls.update();
  renderer.renderAsync(scene, camera);
  
  // 更新 UI (每100ms)
  if (now - lastUiUpdate >= 100) {
    lastUiUpdate = now;
    
    updateInfoDisplay({
      shapeName: SHAPES[state.currentShape].name,
      pointCount: state.pointCount,
      genTime: genTime,
      renderMode: "GPU 着色器 (WebGPU)",
      fps: currentFps,
      drawCalls: renderer.info?.render?.calls ?? 0
    });
    
    // 显示球体位置
    if (physicsBall) {
      const pos = physicsBall.getPosition();
      if (DOM.infoBallPos) {
        DOM.infoBallPos.textContent = `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
      }
    }
  }
}

// ==================== 窗口大小调整 ====================
function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== 异步初始化 ====================
async function init() {
  // 检测 WebGPU 支持
  if (!navigator.gpu) {
    console.error("WebGPU is not supported in this browser");
    return;
  }
  
  // 创建 WebGPU 渲染器
  renderer = new THREE.WebGPURenderer({
    canvas: DOM.canvas,
    antialias: true,
    powerPreference: "high-performance"
  });
  
  await renderer.init();
  
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0a0d12, 1);
  
  // 场景
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 50, 150);
  
  // 灯光
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
  controls.autoRotate = false;
  controls.autoRotateSpeed = 1.0;
  
  // 初始化 UI
  initUIValues({
    pointCount: state.pointCount,
    pointSize: state.pointSize,
    animSpeed: state.animSpeed,
    gridResolution: state.gridResolution,
    colorScheme: state.colorScheme,
    meshParams: state.meshParams
  });
  
  // 设置 UI 事件绑定
  const uniforms = { uSize, uAnimSpeed, uColorScheme };
  setupUIBindings(uiCallbacks, state, uniforms);
  
  // 初始化物理引擎
  const physicsOk = await initPhysics();
  if (physicsOk) {
    createBall();
  }
  
  // 初始化网格重建器
  if (!state.meshEnabled) {
    initMeshReconstructor();
  }
  
  // 创建点云
  rebuildPointCloud();
  
  // 默认开启网格重建
  if (state.meshEnabled) {
    setMeshToggleState(true);
    const success = await initMeshReconstructor();
    if (success) rebuildMesh();
    if (points) points.visible = false;
  }
  
  // 窗口大小调整
  window.addEventListener("resize", onWindowResize);
  
  // 开始渲染循环
  render();
  
  console.log("Three.js WebGPU initialized successfully");
}

// ==================== 启动 ====================
init().catch(console.error);

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { mulberry32, hashCode } from "./random-utils.js";

export class OctreeNode {
  constructor(center, halfSize, depth, path = "r", scene) {
    this.center = center;           // THREE.Vector3
    this.halfSize = halfSize;       // number
    this.depth = depth;             // number
    this.path = path;               // string, 用于生成确定性随机种子
    this.scene = scene;             // THREE.Scene
    this.children = null;           // OctreeNode[8] | null
    this.pointCount = 0;            // 该节点及子树的总点数
    this.nodePointCount = 0;        // 仅该节点自身的点数 (LOD 层)

    // 渲染状态
    this.geometry = null;           // THREE.BufferGeometry
    this.points = null;             // THREE.Points
    this.isLoaded = false;          // 点数据是否已生成
    this.isVisible = false;         // 当前帧是否可见
    this.lastUsedFrame = 0;         // LRU 时间戳
    this.boundingSphere = new THREE.Sphere(center.clone(), halfSize * Math.SQRT2);
  }

  get isLeaf() {
    return this.children === null;
  }

  // 计算屏幕空间误差 (像素)
  computeSSE(camera, screenHeight) {
    const distance = camera.position.distanceTo(this.center);
    if (distance < 0.001) return Infinity;
    const projectedSize = (this.halfSize * 2) / distance;
    const fovFactor = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return (projectedSize / fovFactor) * screenHeight;
  }

  // 生成该节点的点数据 (LOD 层)
  generatePoints() {
    if (this.isLoaded || this.nodePointCount === 0) return;

    const positions = new Float32Array(this.nodePointCount * 3);
    const seed = hashCode(this.path);
    const rng = mulberry32(seed);

    const minX = this.center.x - this.halfSize;
    const minY = this.center.y - this.halfSize;
    const minZ = this.center.z - this.halfSize;
    const size = this.halfSize * 2;

    for (let i = 0; i < this.nodePointCount; i++) {
      const i3 = i * 3;
      positions[i3] = minX + rng() * size;
      positions[i3 + 1] = minY + rng() * size;
      positions[i3 + 2] = minZ + rng() * size;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.computeBoundingSphere();

    // 根据深度调整点大小和颜色
    const depthRatio = this.depth / CONFIG.maxDepth;
    const hue = 0.55 + depthRatio * 0.15; // 蓝色到青色
    const color = new THREE.Color().setHSL(hue, 0.7, 0.6);

    const material = new THREE.PointsMaterial({
      color: color,
      size: Math.max(0.3, 1.5 - depthRatio * 1.2),
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false; // 我们手动做视锥剔除
    this.scene.add(this.points);

    this.isLoaded = true;
  }

  // 卸载点数据
  unload() {
    if (!this.isLoaded) return;

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    this.geometry = null;
    this.isLoaded = false;
  }

  // 显示/隐藏
  setVisible(visible) {
    this.isVisible = visible;
    if (this.points) {
      this.points.visible = visible;
    }
  }
}

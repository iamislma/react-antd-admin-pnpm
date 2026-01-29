/**
 * TSL (Three Shading Language) 形态生成器
 * 包含GPU端点云形态生成和颜色计算函数
 */

import * as THREE from "three";

// 从 THREE.TSL 提取必要的函数
const {
  Fn, uniform, attribute,
  float, vec3, vec4,
  sin, cos, abs, fract, pow, floor, atan2, acos, length, normalize, mix, clamp, step,
  modelViewMatrix
} = THREE.TSL;

// ==================== TSL Uniform 节点 ====================
export const uTime = uniform(0);
export const uSize = uniform(1.5);
export const uAnimSpeed = uniform(0.5);
export const uShape = uniform(0);
export const uColorScheme = uniform(0);

// ==================== TSL 常量 ====================
const PI = float(Math.PI);
const TAU = float(Math.PI * 2);

// ==================== TSL 工具函数 ====================

/**
 * HSV to RGB 转换
 */
export const hsv2rgb = Fn(([h, s, v]) => {
  const K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  const p = abs(fract(vec3(h, h, h).add(vec3(K.x, K.y, K.z))).mul(6.0).sub(vec3(K.w, K.w, K.w)));
  return v.mul(mix(vec3(K.x, K.x, K.x), clamp(p.sub(vec3(K.x, K.x, K.x)), 0.0, 1.0), s));
});

/**
 * 球面坐标转换
 */
export const spherical = Fn(([theta, phi, r]) => {
  const sinPhi = sin(phi);
  return vec3(
    r.mul(sinPhi).mul(cos(theta)),
    r.mul(cos(phi)),
    r.mul(sinPhi).mul(sin(theta))
  );
});

/**
 * 简单噪声函数
 */
export const simpleHash = Fn(([n]) => {
  return fract(sin(n).mul(43758.5453));
});

// ==================== TSL 形态生成函数 ====================

/**
 * 球体形态
 */
export const generateSphere = Fn(([base, time]) => {
  const r1 = base.x;
  const r2 = base.y;
  const r3 = base.z;
  const theta = r1.mul(TAU);
  const phi = acos(r2.mul(2.0).sub(1.0));
  const radius = float(50.0).mul(pow(r3, 0.333));
  const pos = spherical(theta, phi, radius);
  const breath = float(1.0).add(float(0.1).mul(sin(time.mul(2.0).add(radius.mul(0.1)))));
  return pos.mul(breath);
});

/**
 * 立方体形态
 */
export const generateCube = Fn(([base, time]) => {
  const pos = base.sub(0.5).mul(100.0);
  const pulse = float(1.0).add(float(0.05).mul(sin(time.mul(3.0).add(length(pos).mul(0.05)))));
  return pos.mul(pulse);
});

/**
 * 波浪形态
 */
export const generateWave = Fn(([base, time]) => {
  const r1 = base.x;
  const r2 = base.y;
  const r3 = base.z;
  const x = r1.sub(0.5).mul(100.0);
  const z = r2.sub(0.5).mul(100.0);
  const y = sin(x.mul(0.1).add(time)).mul(10.0)
    .add(cos(z.mul(0.1).add(time.mul(0.7))).mul(10.0))
    .add(r3.sub(0.5).mul(5.0));
  return vec3(x, y, z);
});

/**
 * 星系形态
 */
export const generateGalaxy = Fn(([base, time]) => {
  const r1 = base.x;
  const r2 = base.y;
  const r3 = base.z;
  const arm = floor(r1.mul(4.0));
  const t = r2;
  const baseAngle = arm.mul(PI.mul(0.5)).add(t.mul(TAU)).add(t.mul(t).mul(PI));
  const angle = baseAngle.add(time.mul(0.2));
  const radius = t.mul(50.0).add(r3.mul(10.0));
  const height = simpleHash(r1.mul(10.0).add(r2.mul(57.0))).sub(0.5).mul(10.0).mul(float(1.0).sub(t));
  return vec3(
    cos(angle).mul(radius),
    height,
    sin(angle).mul(radius)
  );
});

// ==================== TSL 颜色计算函数 ====================

/**
 * 根据位置和颜色方案计算颜色
 */
export const computeColor = Fn(([pos, scheme]) => {
  const normalizedPos = normalize(pos);
  const len = length(pos);

  // 位置映射 (scheme 0)
  const colorPosition = normalizedPos.mul(0.5).add(0.5);

  // 法线映射 (scheme 1) - 与位置映射相同
  const colorNormal = normalizedPos.mul(0.5).add(0.5);

  // 高度映射 (scheme 2)
  const h = pos.y.add(50.0).div(100.0);
  const colorHeight = hsv2rgb(float(0.6).sub(h.mul(0.4)), 0.8, 0.9);

  // 径向渐变 (scheme 3)
  const d = len.div(60.0);
  const colorRadial = hsv2rgb(float(0.8).sub(d.mul(0.3)), 0.7, 0.9);

  // 彩虹 (scheme 4)
  const angle = atan2(pos.z, pos.x).div(TAU).add(0.5);
  const colorRainbow = hsv2rgb(angle, 0.8, 0.9);

  // 根据 scheme 选择颜色
  return mix(
    mix(
      mix(
        mix(colorPosition, colorNormal, step(0.5, scheme)),
        colorHeight, step(1.5, scheme)
      ),
      colorRadial, step(2.5, scheme)
    ),
    colorRainbow, step(3.5, scheme)
  );
});

/**
 * 创建点云材质
 * @param {THREE.BufferGeometry} geometry - 点云几何体
 * @param {number} currentShapeIndex - 当前形态索引
 * @returns {THREE.PointsNodeMaterial} 点云材质
 */
export function createPointCloudMaterial(geometry, currentShapeIndex) {
  // 获取顶点属性节点
  const aBasePosition = attribute("aBasePosition", "vec3");
  const aRandom = attribute("aRandom", "float");

  // 计算时间值
  const time = uTime.mul(uAnimSpeed);

  // 调用形态生成函数
  const posSphere = generateSphere(aBasePosition, aRandom, time);
  const posCube = generateCube(aBasePosition, aRandom, time);
  const posWave = generateWave(aBasePosition, aRandom, time);
  const posGalaxy = generateGalaxy(aBasePosition, aRandom, time);

  // 根据 shape 选择位置（使用级联 mix + step）
  const shapeF = uShape.toFloat();
  const gpuPos = mix(
    mix(
      mix(posSphere, posCube, step(0.5, shapeF)),
      posWave, step(1.5, shapeF)
    ),
    posGalaxy, step(2.5, shapeF)
  );

  const finalPos = gpuPos;

  // 颜色节点
  const colorResult = computeColor(finalPos, uColorScheme.toFloat());

  // 点大小节点 - 距离衰减
  const mvPosition = modelViewMatrix.mul(vec4(finalPos, 1.0));
  const dist = mvPosition.z.negate();
  const size = uSize.mul(float(300.0).div(dist)).clamp(1.0, 50.0);

  // 创建 PointsNodeMaterial
  const material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false,  // 我们自己处理衰减
  });

  // 设置节点
  material.positionNode = finalPos;
  material.colorNode = vec4(colorResult, 1.0);
  material.sizeNode = size;

  return material;
}

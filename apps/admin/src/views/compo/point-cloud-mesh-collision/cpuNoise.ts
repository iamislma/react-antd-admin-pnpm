/* eslint-disable no-plusplus, no-param-reassign */
/**
 * CPU 版本的 Perlin 噪声和 FBM 函数
 * 用于网格重建时的点云数据生成
 */

import { type ColorScheme, TERRAIN_CONFIG } from './terrainConfig';

/**
 * 3D 哈希函数 - 生成伪随机梯度向量
 */
function hash3CPU(px: number, py: number, pz: number): [number, number, number] {
  const h1 = Math.abs(Math.sin(px * 127.1 + py * 311.7 + pz * 74.7) * 43758.5453) % 1;
  const h2 = Math.abs(Math.sin(px * 269.5 + py * 183.3 + pz * 246.1) * 43758.5453) % 1;
  const h3 = Math.abs(Math.sin(px * 113.5 + py * 271.9 + pz * 124.6) * 43758.5453) % 1;
  const len = Math.sqrt((h1 * 2 - 1) ** 2 + (h2 * 2 - 1) ** 2 + (h3 * 2 - 1) ** 2) || 1;
  return [(h1 * 2 - 1) / len, (h2 * 2 - 1) / len, (h3 * 2 - 1) / len];
}

/** Quintic 平滑插值函数 */
function fadeCPU(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 线性插值 */
function lerpCPU(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** 点积 */
function dotCPU(g: [number, number, number], x: number, y: number, z: number): number {
  return g[0] * x + g[1] * y + g[2] * z;
}

/**
 * 3D Perlin 噪声
 */
export function perlinNoise3DCPU(px: number, py: number, pz: number): number {
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const zi = Math.floor(pz);
  const xf = px - xi;
  const yf = py - yi;
  const zf = pz - zi;

  const g000 = hash3CPU(xi, yi, zi);
  const g100 = hash3CPU(xi + 1, yi, zi);
  const g010 = hash3CPU(xi, yi + 1, zi);
  const g110 = hash3CPU(xi + 1, yi + 1, zi);
  const g001 = hash3CPU(xi, yi, zi + 1);
  const g101 = hash3CPU(xi + 1, yi, zi + 1);
  const g011 = hash3CPU(xi, yi + 1, zi + 1);
  const g111 = hash3CPU(xi + 1, yi + 1, zi + 1);

  const n000 = dotCPU(g000, xf, yf, zf);
  const n100 = dotCPU(g100, xf - 1, yf, zf);
  const n010 = dotCPU(g010, xf, yf - 1, zf);
  const n110 = dotCPU(g110, xf - 1, yf - 1, zf);
  const n001 = dotCPU(g001, xf, yf, zf - 1);
  const n101 = dotCPU(g101, xf - 1, yf, zf - 1);
  const n011 = dotCPU(g011, xf, yf - 1, zf - 1);
  const n111 = dotCPU(g111, xf - 1, yf - 1, zf - 1);

  const u = fadeCPU(xf);
  const v = fadeCPU(yf);
  const w = fadeCPU(zf);

  const x00 = lerpCPU(n000, n100, u);
  const x10 = lerpCPU(n010, n110, u);
  const x01 = lerpCPU(n001, n101, u);
  const x11 = lerpCPU(n011, n111, u);
  const y0 = lerpCPU(x00, x10, v);
  const y1 = lerpCPU(x01, x11, v);

  return lerpCPU(y0, y1, w);
}

/**
 * FBM (Fractal Brownian Motion) 噪声
 */
export function fbmCPU(px: number, py: number, pz: number, lacunarity = 2.0, gain = 0.5, octaves = 6): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += perlinNoise3DCPU(px * frequency, py * frequency, pz * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/**
 * 生成地形点云数据
 */
export function generateTerrainPointsCPU(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const { terrainSize, terrainHeight, noiseFreq } = TERRAIN_CONFIG;
  const halfSize = terrainSize * 0.5;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const r1 = Math.random();
    const r2 = Math.random();
    const r3 = Math.random();

    // 将 [0,1] 映射到 [-halfSize, halfSize]
    const x = r1 * terrainSize - halfSize;
    const z = r2 * terrainSize - halfSize;

    // FBM 噪声采样
    const heightNoise = fbmCPU(x * noiseFreq, 0, z * noiseFreq);

    // 高度映射
    const y = heightNoise * terrainHeight;

    // 微小抖动
    const jitter = 0.2;
    const jitterX = (r3 - 0.5) * jitter;
    const jitterZ = (((r3 * 7.13) % 1) - 0.5) * jitter;

    positions[i3] = x + jitterX;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z + jitterZ;
  }

  return positions;
}

/** Smoothstep 平滑步进函数 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** HSV 转 RGB */
function hsv2rgbCPU(h: number, s: number, v: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
    default:
      r = 0;
      g = 0;
      b = 0;
  }
  return [r, g, b];
}

/**
 * 生成点云颜色数据
 */
export function generateTerrainColors(positions: Float32Array, colorScheme: ColorScheme): Float32Array {
  const pointCount = positions.length / 3;
  const colors = new Float32Array(pointCount * 3);

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    // 地形高度范围约为 [-30, 30]
    const heightNorm = Math.max(0, Math.min(1, (y + 30) / 60));

    let cr: number;
    let cg: number;
    let cb: number;
    switch (colorScheme) {
      case 0: // 位置映射 - XZ 平面位置
        cr = (x + 50) / 100;
        cg = heightNorm;
        cb = (z + 50) / 100;
        break;
      case 1: // 法线映射 - 基于高度的伪法线
        cr = heightNorm * 0.3 + 0.4;
        cg = heightNorm * 0.6 + 0.3;
        cb = (1 - heightNorm) * 0.4 + 0.3;
        break;
      case 2: {
        // 高度映射 - 经典地形配色
        const lowColor = [0.2, 0.5, 0.3];
        const midColor = [0.6, 0.7, 0.3];
        const highColor = [0.9, 0.9, 0.95];
        const t1 = smoothstep(0.0, 0.5, heightNorm);
        const t2 = smoothstep(0.6, 1.0, heightNorm);
        const mid = [
          lowColor[0] * (1 - t1) + midColor[0] * t1,
          lowColor[1] * (1 - t1) + midColor[1] * t1,
          lowColor[2] * (1 - t1) + midColor[2] * t1,
        ];
        cr = mid[0] * (1 - t2) + highColor[0] * t2;
        cg = mid[1] * (1 - t2) + highColor[1] * t2;
        cb = mid[2] * (1 - t2) + highColor[2] * t2;
        break;
      }
      case 3: {
        // 径向渐变 - 从中心向外
        const dist = Math.sqrt(x * x + z * z) / 70;
        const [rr, rg, rb] = hsv2rgbCPU(0.3 - dist * 0.2, 0.6, 0.9 - dist * 0.3);
        cr = rr;
        cg = rg;
        cb = rb;
        break;
      }
      case 4: {
        // 彩虹 - 基于方位角
        const angle = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
        const [hr, hg, hb] = hsv2rgbCPU(angle, 0.7, 0.5 + heightNorm * 0.4);
        cr = hr;
        cg = hg;
        cb = hb;
        break;
      }
      default:
        cr = 0.5;
        cg = 0.5;
        cb = 0.5;
    }

    colors[i * 3] = Math.max(0, Math.min(1, cr));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, cg));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, cb));
  }

  return colors;
}

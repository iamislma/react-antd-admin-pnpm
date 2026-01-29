/**
 * CPU 版本的 Perlin 噪声和 FBM 函数
 * 用于网格重建时的点云数据生成
 */

/**
 * 3D 哈希函数 - 生成伪随机梯度向量
 * @param {number} px - X 坐标
 * @param {number} py - Y 坐标
 * @param {number} pz - Z 坐标
 * @returns {number[]} 归一化的梯度向量 [x, y, z]
 */
export function hash3CPU(px, py, pz) {
  const h1 = Math.abs(Math.sin(px * 127.1 + py * 311.7 + pz * 74.7) * 43758.5453) % 1;
  const h2 = Math.abs(Math.sin(px * 269.5 + py * 183.3 + pz * 246.1) * 43758.5453) % 1;
  const h3 = Math.abs(Math.sin(px * 113.5 + py * 271.9 + pz * 124.6) * 43758.5453) % 1;
  const len = Math.sqrt((h1 * 2 - 1) ** 2 + (h2 * 2 - 1) ** 2 + (h3 * 2 - 1) ** 2) || 1;
  return [(h1 * 2 - 1) / len, (h2 * 2 - 1) / len, (h3 * 2 - 1) / len];
}

/**
 * Quintic 平滑插值函数
 * @param {number} t - 插值参数 [0, 1]
 * @returns {number} 平滑后的值
 */
export function fadeCPU(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 线性插值
 * @param {number} a - 起始值
 * @param {number} b - 结束值
 * @param {number} t - 插值参数 [0, 1]
 * @returns {number} 插值结果
 */
export function lerpCPU(a, b, t) {
  return a + t * (b - a);
}

/**
 * 点积
 * @param {number[]} g - 梯度向量 [x, y, z]
 * @param {number} x - X 分量
 * @param {number} y - Y 分量
 * @param {number} z - Z 分量
 * @returns {number} 点积结果
 */
export function dotCPU(g, x, y, z) {
  return g[0] * x + g[1] * y + g[2] * z;
}

/**
 * 3D Perlin 噪声
 * @param {number} px - X 坐标
 * @param {number} py - Y 坐标
 * @param {number} pz - Z 坐标
 * @returns {number} 噪声值 [-1, 1]
 */
export function perlinNoise3DCPU(px, py, pz) {
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
 * @param {number} px - X 坐标
 * @param {number} py - Y 坐标
 * @param {number} pz - Z 坐标
 * @param {number} lacunarity - 频率倍增因子 (默认 2.0)
 * @param {number} gain - 振幅衰减因子 (默认 0.5)
 * @param {number} octaves - 八度数 (默认 6)
 * @returns {number} FBM 噪声值 [-1, 1]
 */
export function fbmCPU(px, py, pz, lacunarity = 2.0, gain = 0.5, octaves = 6) {
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
 * @param {string} shape - 形状类型 (固定为 "terrain")
 * @param {number} count - 点数量
 * @param {number} time - 时间 (未使用，保留用于兼容性)
 * @returns {Float32Array} 点云位置数组 (x, y, z 交织)
 */
export function generatePointsCPU(shape, count, time = 0) {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const r1 = Math.random();
    const r2 = Math.random();
    const r3 = Math.random();

    // 地形生成 - 与 TSL 版本保持一致
    const terrainSize = 100.0;
    const halfSize = terrainSize * 0.5;

    // 将 [0,1] 映射到 [-halfSize, halfSize]
    const x = r1 * terrainSize - halfSize;
    const z = r2 * terrainSize - halfSize;

    // FBM 噪声采样
    const noiseFreq = 0.03;
    const heightNoise = fbmCPU(x * noiseFreq, 0, z * noiseFreq);

    // 高度映射
    const terrainHeight = 30.0;
    const y = heightNoise * terrainHeight;

    // 微小抖动
    const jitter = 0.2;
    const jitterX = (r3 - 0.5) * jitter;
    const jitterZ = ((r3 * 7.13) % 1 - 0.5) * jitter;

    positions[i3] = x + jitterX;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z + jitterZ;
  }

  return positions;
}

/**
 * Smoothstep 平滑步进函数
 * @param {number} edge0 - 下边界
 * @param {number} edge1 - 上边界
 * @param {number} x - 输入值
 * @returns {number} 平滑步进结果 [0, 1]
 */
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * HSV 转 RGB
 * @param {number} h - 色相 [0, 1]
 * @param {number} s - 饱和度 [0, 1]
 * @param {number} v - 明度 [0, 1]
 * @returns {number[]} RGB 颜色 [r, g, b]
 */
export function hsv2rgbCPU(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: r = g = b = 0;
  }
  return [r, g, b];
}

/**
 * 生成点云颜色数据
 * @param {Float32Array} positions - 点云位置数组
 * @param {number} colorScheme - 颜色方案 (0-4)
 * @returns {Float32Array} 颜色数组 (r, g, b 交织)
 */
export function generatePointColors(positions, colorScheme) {
  const pointCount = positions.length / 3;
  const colors = new Float32Array(pointCount * 3);

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    // 地形高度范围约为 [-30, 30]
    const heightNorm = Math.max(0, Math.min(1, (y + 30) / 60));

    let cr, cg, cb;
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
      case 2: // 高度映射 - 经典地形配色
        // 低处: 深绿 -> 中间: 黄绿 -> 高处: 雪白
        const lowColor = [0.2, 0.5, 0.3];
        const midColor = [0.6, 0.7, 0.3];
        const highColor = [0.9, 0.9, 0.95];
        const t1 = smoothstep(0.0, 0.5, heightNorm);
        const t2 = smoothstep(0.6, 1.0, heightNorm);
        const mid = [
          lowColor[0] * (1 - t1) + midColor[0] * t1,
          lowColor[1] * (1 - t1) + midColor[1] * t1,
          lowColor[2] * (1 - t1) + midColor[2] * t1
        ];
        cr = mid[0] * (1 - t2) + highColor[0] * t2;
        cg = mid[1] * (1 - t2) + highColor[1] * t2;
        cb = mid[2] * (1 - t2) + highColor[2] * t2;
        break;
      case 3: // 径向渐变 - 从中心向外
        const dist = Math.sqrt(x * x + z * z) / 70;
        const [rr, rg, rb] = hsv2rgbCPU(0.3 - dist * 0.2, 0.6, 0.9 - dist * 0.3);
        cr = rr; cg = rg; cb = rb;
        break;
      case 4: // 彩虹 - 基于方位角
        const angle = (Math.atan2(z, x) / (2 * Math.PI)) + 0.5;
        const [hr, hg, hb] = hsv2rgbCPU(angle, 0.7, 0.5 + heightNorm * 0.4);
        cr = hr; cg = hg; cb = hb;
        break;
      default:
        cr = cg = cb = 0.5;
    }

    colors[i * 3] = Math.max(0, Math.min(1, cr));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, cg));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, cb));
  }

  return colors;
}

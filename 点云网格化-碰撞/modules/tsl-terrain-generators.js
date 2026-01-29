/**
 * TSL 地形生成器函数
 * 基于 FBM + Perlin 噪声生成地形点云
 */

import * as THREE from 'three';

// 从 THREE.TSL 命名空间解构 TSL 函数
const {
  Fn,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  floor,
  fract,
  abs,
  sin,
  dot,
  mix,
  clamp,
  normalize,
  length,
  atan2,
  smoothstep,
  step
} = THREE.TSL;

// ==================== TSL Uniforms ====================
export const uTime = uniform(0.0);
export const uSize = uniform(1.0);
export const uAnimSpeed = uniform(0.3);
export const uShape = uniform(0); // 形状 uniform (未使用于地形)
export const uColorScheme = uniform(0);

// TAU 常量
const TAU = float(Math.PI * 2);

// ==================== HSV to RGB 转换 ====================
export const hsv2rgb = Fn(([h, s, v]) => {
  const K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  const p = abs(fract(vec3(h, h, h).add(vec3(K.x, K.y, K.z))).mul(6.0).sub(vec3(K.w, K.w, K.w)));
  return v.mul(mix(vec3(K.x, K.x, K.x), clamp(p.sub(vec3(K.x, K.x, K.x)), 0.0, 1.0), s));
});

// ==================== TSL Perlin 噪声实现 ====================

/**
 * 3D 伪随机梯度哈希函数
 */
export const hash3 = Fn(([p]) => {
  const px = p.x;
  const py = p.y;
  const pz = p.z;
  // 使用不同的大质数进行哈希
  const h1 = fract(sin(px.mul(127.1).add(py.mul(311.7)).add(pz.mul(74.7))).mul(43758.5453));
  const h2 = fract(sin(px.mul(269.5).add(py.mul(183.3)).add(pz.mul(246.1))).mul(43758.5453));
  const h3 = fract(sin(px.mul(113.5).add(py.mul(271.9)).add(pz.mul(124.6))).mul(43758.5453));
  // 映射到 [-1, 1] 并归一化
  return normalize(vec3(h1.mul(2.0).sub(1.0), h2.mul(2.0).sub(1.0), h3.mul(2.0).sub(1.0)));
});

/**
 * 平滑插值函数 (quintic)
 */
export const fade = Fn(([t]) => {
  return t.mul(t).mul(t).mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0));
});

/**
 * 3D Perlin 噪声
 */
export const perlinNoise3D = Fn(([p]) => {
  // 整数部分（晶格点）
  const pi = floor(p);
  // 小数部分
  const pf = fract(p);

  // 获取8个晶格角点的梯度
  const g000 = hash3(pi);
  const g100 = hash3(pi.add(vec3(1.0, 0.0, 0.0)));
  const g010 = hash3(pi.add(vec3(0.0, 1.0, 0.0)));
  const g110 = hash3(pi.add(vec3(1.0, 1.0, 0.0)));
  const g001 = hash3(pi.add(vec3(0.0, 0.0, 1.0)));
  const g101 = hash3(pi.add(vec3(1.0, 0.0, 1.0)));
  const g011 = hash3(pi.add(vec3(0.0, 1.0, 1.0)));
  const g111 = hash3(pi.add(vec3(1.0, 1.0, 1.0)));

  // 计算到各角点的向量
  const d000 = pf;
  const d100 = pf.sub(vec3(1.0, 0.0, 0.0));
  const d010 = pf.sub(vec3(0.0, 1.0, 0.0));
  const d110 = pf.sub(vec3(1.0, 1.0, 0.0));
  const d001 = pf.sub(vec3(0.0, 0.0, 1.0));
  const d101 = pf.sub(vec3(1.0, 0.0, 1.0));
  const d011 = pf.sub(vec3(0.0, 1.0, 1.0));
  const d111 = pf.sub(vec3(1.0, 1.0, 1.0));

  // 计算点积
  const n000 = dot(g000, d000);
  const n100 = dot(g100, d100);
  const n010 = dot(g010, d010);
  const n110 = dot(g110, d110);
  const n001 = dot(g001, d001);
  const n101 = dot(g101, d101);
  const n011 = dot(g011, d011);
  const n111 = dot(g111, d111);

  // 平滑插值
  const u = fade(pf.x);
  const v = fade(pf.y);
  const w = fade(pf.z);

  // 三线性插值
  const x00 = mix(n000, n100, u);
  const x10 = mix(n010, n110, u);
  const x01 = mix(n001, n101, u);
  const x11 = mix(n011, n111, u);

  const y0 = mix(x00, x10, v);
  const y1 = mix(x01, x11, v);

  return mix(y0, y1, w);
});

/**
 * FBM (Fractal Brownian Motion) - 静态版本，展开 6 个八度
 */
export const fbm = Fn(([p, lacunarity, gain]) => {
  // 八度1
  const freq1 = float(1.0);
  const amp1 = float(1.0);
  const n1 = perlinNoise3D(p.mul(freq1)).mul(amp1);

  // 八度2
  const freq2 = freq1.mul(lacunarity);
  const amp2 = amp1.mul(gain);
  const n2 = perlinNoise3D(p.mul(freq2)).mul(amp2);

  // 八度3
  const freq3 = freq2.mul(lacunarity);
  const amp3 = amp2.mul(gain);
  const n3 = perlinNoise3D(p.mul(freq3)).mul(amp3);

  // 八度4
  const freq4 = freq3.mul(lacunarity);
  const amp4 = amp3.mul(gain);
  const n4 = perlinNoise3D(p.mul(freq4)).mul(amp4);

  // 八度5
  const freq5 = freq4.mul(lacunarity);
  const amp5 = amp4.mul(gain);
  const n5 = perlinNoise3D(p.mul(freq5)).mul(amp5);

  // 八度6
  const freq6 = freq5.mul(lacunarity);
  const amp6 = amp5.mul(gain);
  const n6 = perlinNoise3D(p.mul(freq6)).mul(amp6);

  // 累加和归一化
  const totalAmp = amp1.add(amp2).add(amp3).add(amp4).add(amp5).add(amp6);
  const totalNoise = n1.add(n2).add(n3).add(n4).add(n5).add(n6);

  return totalNoise.div(totalAmp);
});

// ==================== TSL 地形生成函数 (静态) ====================
/**
 * 根据基础参数生成地形点坐标
 * @param base - vec3，其中 xy 为 [0,1] 范围的随机种子，z 为微小随机偏移
 */
export const generateTerrain = Fn(([base]) => {
  // base.xy 为 [0,1] 范围的随机种子，用于在 XZ 平面均匀分布
  const xBase = base.x;
  const zBase = base.y;
  const randomOffset = base.z; // 用于微小随机偏移

  // 地形尺寸: 100x100 单位的平面
  const terrainSize = float(100.0);
  const halfSize = terrainSize.mul(0.5);

  // 将 [0,1] 映射到 [-halfSize, halfSize]
  const x = xBase.mul(terrainSize).sub(halfSize);
  const z = zBase.mul(terrainSize).sub(halfSize);

  // FBM 噪声采样点 - 缩放到合适频率
  const noiseFreq = float(0.03); // 控制地形细节密度
  const samplePoint = vec3(x.mul(noiseFreq), float(0.0), z.mul(noiseFreq));

  // 使用 FBM 生成高度
  // 参数: lacunarity = 2.0 (频率倍增), gain = 0.5 (振幅衰减)
  const heightNoise = fbm(samplePoint, float(2.0), float(0.5));

  // 高度映射: 噪声值 [-1,1] 映射到地形高度
  const terrainHeight = float(30.0); // 最大高度变化
  const baseHeight = float(0.0);     // 基础高度
  const y = baseHeight.add(heightNoise.mul(terrainHeight));

  // 添加微小随机偏移增加点云密度感
  const jitter = float(0.2);
  const jitterX = randomOffset.sub(0.5).mul(jitter);
  const jitterZ = fract(randomOffset.mul(7.13)).sub(0.5).mul(jitter);

  return vec3(x.add(jitterX), y, z.add(jitterZ));
});

// ==================== TSL 颜色计算函数 (地形专用) ====================
/**
 * 根据位置和颜色方案计算点云颜色
 * @param pos - vec3 位置
 * @param scheme - float 颜色方案 (0-4)
 */
export const computeColor = Fn(([pos, scheme]) => {
  // 地形高度范围约为 [-30, 30]
  const heightNorm = pos.y.add(30.0).div(60.0).clamp(0.0, 1.0);

  // 位置映射 (scheme 0) - XZ 平面位置
  const colorPosition = vec3(
    pos.x.add(50.0).div(100.0),
    heightNorm,
    pos.z.add(50.0).div(100.0)
  );

  // 法线映射 (scheme 1) - 基于梯度估算的伪法线
  const colorNormal = vec3(
    heightNorm.mul(0.3).add(0.4),
    heightNorm.mul(0.6).add(0.3),
    float(1.0).sub(heightNorm).mul(0.4).add(0.3)
  );

  // 高度映射 (scheme 2) - 经典地形配色
  // 低处: 蓝绿 (水/草) -> 中间: 绿黄 (草地) -> 高处: 白灰 (雪/岩)
  const lowColor = vec3(0.2, 0.5, 0.3);   // 深绿
  const midColor = vec3(0.6, 0.7, 0.3);   // 黄绿
  const highColor = vec3(0.9, 0.9, 0.95); // 雪白
  const colorHeight = mix(
    mix(lowColor, midColor, smoothstep(0.0, 0.5, heightNorm)),
    highColor,
    smoothstep(0.6, 1.0, heightNorm)
  );

  // 径向渐变 (scheme 3) - 从中心向外
  const dist = length(vec2(pos.x, pos.z)).div(70.0);
  const colorRadial = hsv2rgb(float(0.3).sub(dist.mul(0.2)), 0.6, float(0.9).sub(dist.mul(0.3)));

  // 彩虹 (scheme 4) - 基于方位角
  const angle = atan2(pos.z, pos.x).div(TAU).add(0.5);
  const colorRainbow = hsv2rgb(angle, 0.7, float(0.5).add(heightNorm.mul(0.4)));

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

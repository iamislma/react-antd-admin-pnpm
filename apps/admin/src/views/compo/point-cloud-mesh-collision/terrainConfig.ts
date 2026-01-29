/* eslint-disable no-plusplus */
/**
 * 地形配置模块
 * 定义地形生成和物理模拟的参数
 */

/** 颜色方案定义 */
export const COLOR_SCHEMES = [
  { name: '位置映射', value: 0 },
  { name: '法线映射', value: 1 },
  { name: '高度映射', value: 2 },
  { name: '径向渐变', value: 3 },
  { name: '彩虹', value: 4 },
];

/** 颜色方案类型 */
export type ColorScheme = 0 | 1 | 2 | 3 | 4;

/** 默认配置 */
export const DEFAULT_CONFIG = {
  // 点云参数
  pointCount: 1000000,
  pointSize: 1.5,
  animSpeed: 0.5,
  colorScheme: 2 as ColorScheme, // 高度映射

  // 网格重建参数
  gridResolution: 160,
  isoValue: 1.7,
  splatRadius: 3.0,
  meshOpacity: 0.9,

  // 物理球体参数
  ball: {
    force: 400,
    jumpForce: 250,
    damping: 0.3,
    airControl: 0.6,
    friction: 0.5,
    restitution: 0.4,
  },
};

/** 地形配置接口 */
export interface TerrainConfig {
  terrainSize: number;
  terrainHeight: number;
  noiseFreq: number;
  lacunarity: number;
  gain: number;
  octaves: number;
}

/** 默认地形配置 */
export const TERRAIN_CONFIG: TerrainConfig = {
  terrainSize: 100.0,
  terrainHeight: 30.0,
  noiseFreq: 0.03,
  lacunarity: 2.0,
  gain: 0.5,
  octaves: 6,
};

/** 键盘控制状态 */
export interface KeysPressed {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  space: boolean;
}

/**
 * 点云形态配置
 * 定义可用的形态类型及其元数据
 */

// 形态定义
export const SHAPES = {
  sphere: { name: "球体", icon: "", description: "均匀分布在球面上" },
  cube: { name: "立方体", icon: "", description: "立方体表面或体积分布" },
  wave: { name: "波浪", icon: "", description: "正弦波动的平面" },
  galaxy: { name: "星系", icon: "", description: "螺旋臂星系形态" },
};

// 颜色方案定义
export const COLOR_SCHEMES = [
  { name: "位置映射", value: 0 },
  { name: "法线映射", value: 1 },
  { name: "高度映射", value: 2 },
  { name: "径向渐变", value: 3 },
  { name: "彩虹", value: 4 },
];

// 默认配置
export const DEFAULT_CONFIG = {
  pointCount: 500000,
  pointSize: 1.5,
  animSpeed: 0.5,
  colorScheme: 0,
  currentShape: "sphere",
  
  // 网格重建参数
  mesh: {
    enabled: false,
    gridResolution: 64,
    isoValue: 0.5,
    splatRadius: 2.0,
    meshOpacity: 0.9,
  }
};

/**
 * 获取形态索引
 * @param {string} shapeKey - 形态键名
 * @returns {number} 形态索引
 */
export function getShapeIndex(shapeKey) {
  return Object.keys(SHAPES).indexOf(shapeKey);
}

/**
 * 获取所有形态键名
 * @returns {string[]} 形态键名数组
 */
export function getShapeKeys() {
  return Object.keys(SHAPES);
}

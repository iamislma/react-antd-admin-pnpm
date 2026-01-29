export const CONFIG = {
  worldSize: 500,                    // 世界边界 [-250, 250]
  maxDepth: 8,                       // 八叉树最大深度 (2^8 = 256 细分)
  pointsPerLeaf: 50000,              // 每个叶节点的点数
  pointBudget: 5_000_000,            // 每帧渲染点数上限
  sseThreshold: 1.5,                 // 屏幕空间误差阈值 (像素)
  maxLoadedNodes: 200,               // 最大加载节点数 (LRU)
  lodBase: 0.5,                      // LOD 基础密度因子
};

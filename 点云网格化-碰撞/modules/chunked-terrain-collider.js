/**
 * 分块地形碰撞管理器
 * 将地形网格分割成多个块，只激活球体附近的碰撞体
 * 用于优化大型地形的物理碰撞性能
 */

/**
 * ChunkedTerrainCollider 类
 * 管理基于分块的地形碰撞
 */
export class ChunkedTerrainCollider {
  /**
   * 创建分块地形碰撞管理器
   * @param {Object} world - Rapier 物理世界
   * @param {Object} RAPIER - Rapier 模块引用
   * @param {number} chunkCountX - X 方向块数量 (默认 10)
   * @param {number} chunkCountZ - Z 方向块数量 (默认 10)
   */
  constructor(world, RAPIER, chunkCountX = 10, chunkCountZ = 10) {
    this.world = world;
    this.RAPIER = RAPIER;
    this.chunkCountX = chunkCountX;
    this.chunkCountZ = chunkCountZ;

    // 地形范围: X ∈ [-50, 50], Z ∈ [-50, 50]
    this.minX = -50;
    this.maxX = 50;
    this.minZ = -50;
    this.maxZ = 50;

    this.chunkSizeX = (this.maxX - this.minX) / chunkCountX;
    this.chunkSizeZ = (this.maxZ - this.minZ) / chunkCountZ;

    // 存储每个块的三角形数据
    // chunks[chunkX][chunkZ] = { triangles: [], collider: null, active: false }
    this.chunks = [];
    for (let x = 0; x < chunkCountX; x++) {
      this.chunks[x] = [];
      for (let z = 0; z < chunkCountZ; z++) {
        this.chunks[x][z] = { triangles: [], collider: null, active: false };
      }
    }

    // 活跃块集合
    this.activeChunks = new Set();
    this.activeRadius = 2;  // 以球体所在块为中心，激活 (2*2+1)^2 = 25 块
  }

  /**
   * 从网格几何体构建分块数据
   * @param {Float32Array} positions - 网格顶点位置数组 (每9个值构成一个三角形)
   */
  buildFromMesh(positions) {
    const triangleCount = positions.length / 9;
    console.log(`Building chunked terrain from ${triangleCount} triangles...`);

    // 清空旧数据
    for (let x = 0; x < this.chunkCountX; x++) {
      for (let z = 0; z < this.chunkCountZ; z++) {
        if (this.chunks[x][z].collider) {
          this.world.removeCollider(this.chunks[x][z].collider, true);
        }
        this.chunks[x][z] = { triangles: [], collider: null, active: false };
      }
    }
    this.activeChunks.clear();

    // 将三角形分配到块中
    for (let i = 0; i < triangleCount; i++) {
      const baseIdx = i * 9;

      // 计算三角形中心
      const cx = (positions[baseIdx] + positions[baseIdx + 3] + positions[baseIdx + 6]) / 3;
      const cz = (positions[baseIdx + 2] + positions[baseIdx + 5] + positions[baseIdx + 8]) / 3;

      // 确定所属块
      const chunkX = Math.floor((cx - this.minX) / this.chunkSizeX);
      const chunkZ = Math.floor((cz - this.minZ) / this.chunkSizeZ);

      // 边界检查
      const clampedX = Math.max(0, Math.min(this.chunkCountX - 1, chunkX));
      const clampedZ = Math.max(0, Math.min(this.chunkCountZ - 1, chunkZ));

      // 存储三角形的 9 个坐标
      this.chunks[clampedX][clampedZ].triangles.push(
        positions[baseIdx], positions[baseIdx + 1], positions[baseIdx + 2],
        positions[baseIdx + 3], positions[baseIdx + 4], positions[baseIdx + 5],
        positions[baseIdx + 6], positions[baseIdx + 7], positions[baseIdx + 8]
      );
    }

    // 统计
    let totalTriangles = 0;
    let maxTriangles = 0;
    let nonEmptyChunks = 0;
    for (let x = 0; x < this.chunkCountX; x++) {
      for (let z = 0; z < this.chunkCountZ; z++) {
        const count = this.chunks[x][z].triangles.length / 9;
        if (count > 0) {
          nonEmptyChunks++;
          totalTriangles += count;
          maxTriangles = Math.max(maxTriangles, count);
        }
      }
    }
    console.log(`Chunked terrain: ${nonEmptyChunks} non-empty chunks, avg ${(totalTriangles / nonEmptyChunks).toFixed(0)} tri/chunk, max ${maxTriangles} tri/chunk`);
  }

  /**
   * 根据球体位置更新活跃块
   * @param {number} ballX - 球体 X 坐标
   * @param {number} ballZ - 球体 Z 坐标
   * @returns {number} 当前活跃块数量
   */
  updateActiveChunks(ballX, ballZ) {
    const currentChunkX = Math.floor((ballX - this.minX) / this.chunkSizeX);
    const currentChunkZ = Math.floor((ballZ - this.minZ) / this.chunkSizeZ);

    const newActiveChunks = new Set();

    // 激活球体周围的块
    for (let dx = -this.activeRadius; dx <= this.activeRadius; dx++) {
      for (let dz = -this.activeRadius; dz <= this.activeRadius; dz++) {
        const cx = currentChunkX + dx;
        const cz = currentChunkZ + dz;

        if (cx >= 0 && cx < this.chunkCountX && cz >= 0 && cz < this.chunkCountZ) {
          const key = `${cx},${cz}`;
          newActiveChunks.add(key);

          // 如果这个块之前不活跃，现在需要激活
          if (!this.activeChunks.has(key)) {
            this.activateChunk(cx, cz);
          }
        }
      }
    }

    // 停用不再活跃的块
    for (const key of this.activeChunks) {
      if (!newActiveChunks.has(key)) {
        const [cx, cz] = key.split(',').map(Number);
        this.deactivateChunk(cx, cz);
      }
    }

    this.activeChunks = newActiveChunks;
    return this.activeChunks.size;
  }

  /**
   * 激活一个块的碰撞
   * @param {number} chunkX - 块 X 索引
   * @param {number} chunkZ - 块 Z 索引
   */
  activateChunk(chunkX, chunkZ) {
    const chunk = this.chunks[chunkX][chunkZ];
    if (chunk.active || chunk.triangles.length === 0) return;

    // 构建 Trimesh 碰撞体
    const triangleCount = chunk.triangles.length / 9;
    const vertices = new Float32Array(triangleCount * 9);
    const indices = new Uint32Array(triangleCount * 3);

    for (let i = 0; i < chunk.triangles.length; i++) {
      vertices[i] = chunk.triangles[i];
    }

    for (let i = 0; i < triangleCount * 3; i++) {
      indices[i] = i;
    }

    try {
      const colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(0.8)
        .setRestitution(0.2);

      chunk.collider = this.world.createCollider(colliderDesc);
      chunk.active = true;
    } catch (e) {
      console.warn(`Failed to create collider for chunk (${chunkX}, ${chunkZ}):`, e);
    }
  }

  /**
   * 停用一个块的碰撞
   * @param {number} chunkX - 块 X 索引
   * @param {number} chunkZ - 块 Z 索引
   */
  deactivateChunk(chunkX, chunkZ) {
    const chunk = this.chunks[chunkX][chunkZ];
    if (!chunk.active || !chunk.collider) return;

    this.world.removeCollider(chunk.collider, true);
    chunk.collider = null;
    chunk.active = false;
  }

  /**
   * 销毁所有碰撞体
   */
  destroy() {
    for (let x = 0; x < this.chunkCountX; x++) {
      for (let z = 0; z < this.chunkCountZ; z++) {
        if (this.chunks[x][z].collider) {
          this.world.removeCollider(this.chunks[x][z].collider, true);
        }
      }
    }
    this.activeChunks.clear();
  }
}

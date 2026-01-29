/**
 * 网格重建器类 (GPU Marching Cubes)
 * 使用 WebGPU Compute Shader 实现高性能网格重建
 */

import {
  clearVoxelShader,
  splatPointsShader,
  normalizeDensityShader,
  marchingCubesShader
} from './wgsl-shaders.js';

import { EDGE_TABLE, TRI_TABLE } from './marching-cubes-tables.js';

/**
 * MeshReconstructor 类
 * 使用 GPU 加速的 Marching Cubes 算法从点云重建网格
 */
export class MeshReconstructor {
  constructor() {
    this.device = null;
    this.initialized = false;
    this.numPoints = 0;
    this.gridSize = [64, 64, 64];
    this.triangleCount = 0;
    this.params = {
      isoValue: 0.5,
      splatRadius: 1.5,
      gridMin: [-60, -60, -60],
      gridMax: [60, 60, 60],
    };
    this.lastComputeTime = 0;
    
    // 使用导入的查找表
    this.edgeTable = EDGE_TABLE;
    this.triTable = TRI_TABLE;
  }

  /**
   * 初始化 WebGPU 设备和管线
   */
  async init() {
    if (!navigator.gpu) {
      console.warn("WebGPU not supported for mesh reconstruction");
      return false;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return false;

      const adapterLimits = adapter.limits;
      const maxBufferSize = Math.min(adapterLimits.maxBufferSize, 1024 * 1024 * 1024);
      const maxStorageBufferBindingSize = Math.min(adapterLimits.maxStorageBufferBindingSize, 1024 * 1024 * 1024);

      this.device = await adapter.requestDevice({
        requiredLimits: { maxBufferSize, maxStorageBufferBindingSize }
      });
      this.maxBufferSize = this.device.limits.maxBufferSize;

      this.createShaderModules();
      this.createPipelines();

      this.initialized = true;
      console.log("MeshReconstructor WebGPU initialized");
      return true;
    } catch (e) {
      console.error("MeshReconstructor init failed:", e);
      return false;
    }
  }

  /**
   * 创建着色器模块
   */
  createShaderModules() {
    this.clearVoxelModule = this.device.createShaderModule({ code: clearVoxelShader, label: "clearVoxel" });
    this.splatPointsModule = this.device.createShaderModule({ code: splatPointsShader, label: "splatPoints" });
    this.normalizeDensityModule = this.device.createShaderModule({ code: normalizeDensityShader, label: "normalizeDensity" });
    this.marchingCubesModule = this.device.createShaderModule({ code: marchingCubesShader, label: "marchingCubes" });
  }

  /**
   * 创建计算管线
   */
  createPipelines() {
    this.clearVoxelPipeline = this.device.createComputePipeline({ 
      label: "clearVoxel", 
      layout: "auto", 
      compute: { module: this.clearVoxelModule, entryPoint: "main" } 
    });
    this.splatPointsPipeline = this.device.createComputePipeline({ 
      label: "splatPoints", 
      layout: "auto", 
      compute: { module: this.splatPointsModule, entryPoint: "main" } 
    });
    this.normalizeDensityPipeline = this.device.createComputePipeline({ 
      label: "normalizeDensity", 
      layout: "auto", 
      compute: { module: this.normalizeDensityModule, entryPoint: "main" } 
    });
    this.marchingCubesPipeline = this.device.createComputePipeline({ 
      label: "marchingCubes", 
      layout: "auto", 
      compute: { module: this.marchingCubesModule, entryPoint: "main" } 
    });
  }

  /**
   * 设置点云数据
   * @param {Float32Array} positions - 点云位置数组 (x,y,z 交织)
   * @param {Float32Array} colors - 点云颜色数组 (r,g,b 交织)
   * @param {number} count - 点数量
   * @param {number} gridRes - 体素网格分辨率
   */
  setPointCloud(positions, colors, count, gridRes) {
    if (!this.initialized) return;
    this.destroyBuffers();
    this.numPoints = count;
    this.gridSize = [gridRes, gridRes, gridRes];
    const gridCount = gridRes * gridRes * gridRes;

    // 计算包围盒
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const padding = this.params.splatRadius * 2;
    this.params.gridMin = [minX - padding, minY - padding, minZ - padding];
    this.params.gridMax = [maxX + padding, maxY + padding, maxZ + padding];

    // 点云位置缓冲区
    const pointData = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pointData[i * 4] = positions[i * 3];
      pointData[i * 4 + 1] = positions[i * 3 + 1];
      pointData[i * 4 + 2] = positions[i * 3 + 2];
      pointData[i * 4 + 3] = 0;
    }
    this.pointsBuffer = this.device.createBuffer({ 
      label: "points", 
      size: count * 16, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.device.queue.writeBuffer(this.pointsBuffer, 0, pointData);

    // 颜色缓冲区
    const colorData = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      colorData[i * 4] = colors ? colors[i * 3] : 0.5;
      colorData[i * 4 + 1] = colors ? colors[i * 3 + 1] : 0.5;
      colorData[i * 4 + 2] = colors ? colors[i * 3 + 2] : 0.5;
      colorData[i * 4 + 3] = 1.0;
    }
    this.colorsBuffer = this.device.createBuffer({ 
      label: "colors", 
      size: count * 16, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.device.queue.writeBuffer(this.colorsBuffer, 0, colorData);

    // 体素缓冲区
    this.voxelBuffer = this.device.createBuffer({ 
      label: "voxel", 
      size: gridCount * 4, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.voxelColorsRBuffer = this.device.createBuffer({ 
      label: "voxelR", 
      size: gridCount * 4, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.voxelColorsGBuffer = this.device.createBuffer({ 
      label: "voxelG", 
      size: gridCount * 4, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.voxelColorsBBuffer = this.device.createBuffer({ 
      label: "voxelB", 
      size: gridCount * 4, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.normalizedColorsBuffer = this.device.createBuffer({ 
      label: "normalizedColors", 
      size: gridCount * 16, 
      usage: GPUBufferUsage.STORAGE 
    });
    this.densityBuffer = this.device.createBuffer({ 
      label: "density", 
      size: gridCount * 4, 
      usage: GPUBufferUsage.STORAGE 
    });

    // 顶点输出 - 使用基于表面积的合理估计
    const surfaceVoxels = 6 * gridRes * gridRes * 2;
    const maxTriangles = Math.min(surfaceVoxels * 5, gridCount);
    const maxVertices = maxTriangles * 3;
    const bytesPerVertex = 48;
    const vertexBufferSize = maxVertices * bytesPerVertex;

    // 限制最大缓冲区大小
    const maxAllowedSize = Math.min(this.maxBufferSize, 512 * 1024 * 1024);
    if (vertexBufferSize > maxAllowedSize) {
      console.warn(`Reducing vertex buffer from ${(vertexBufferSize / 1024 / 1024).toFixed(0)}MB to ${(maxAllowedSize / 1024 / 1024).toFixed(0)}MB`);
    }
    const actualBufferSize = Math.min(vertexBufferSize, maxAllowedSize);

    this.vertexBuffer = this.device.createBuffer({ 
      label: "vertices", 
      size: actualBufferSize, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC 
    });
    this.triangleCountBuffer = this.device.createBuffer({ 
      label: "triCount", 
      size: 4, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST 
    });
    this.readbackBuffer = this.device.createBuffer({ 
      label: "readback", 
      size: actualBufferSize, 
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST 
    });
    this.maxTriangleCount = Math.floor(actualBufferSize / bytesPerVertex / 3);
    this.countReadbackBuffer = this.device.createBuffer({ 
      label: "countReadback", 
      size: 4, 
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST 
    });

    // Uniform 缓冲区
    this.gridSizeBuffer = this.device.createBuffer({ 
      label: "gridSize", 
      size: 16, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
    });
    this.device.queue.writeBuffer(this.gridSizeBuffer, 0, new Uint32Array([...this.gridSize, 0]));
    
    this.numPointsBuffer = this.device.createBuffer({ 
      label: "numPoints", 
      size: 4, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
    });
    this.device.queue.writeBuffer(this.numPointsBuffer, 0, new Uint32Array([count]));
    
    this.paramsBuffer = this.device.createBuffer({ 
      label: "splatParams", 
      size: 48, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
    });
    this.mcParamsBuffer = this.device.createBuffer({ 
      label: "mcParams", 
      size: 16, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
    });
    this.gridMinBuffer = this.device.createBuffer({ 
      label: "gridMin", 
      size: 16, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
    });
    this.gridMaxBuffer = this.device.createBuffer({ 
      label: "gridMax", 
      size: 16, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
    });

    // 查找表缓冲区
    this.edgeTableBuffer = this.device.createBuffer({ 
      label: "edgeTable", 
      size: this.edgeTable.byteLength, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.device.queue.writeBuffer(this.edgeTableBuffer, 0, this.edgeTable);
    
    this.triTableBuffer = this.device.createBuffer({ 
      label: "triTable", 
      size: this.triTable.byteLength, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
    });
    this.device.queue.writeBuffer(this.triTableBuffer, 0, this.triTable);

    this.createBindGroups();
  }

  /**
   * 更新点云 Splat 参数
   */
  updateSplatParams() {
    const data = new Float32Array([
      ...this.params.gridMin, 0, 
      ...this.params.gridMax, 0, 
      this.params.splatRadius, 0, 0, 0
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
  }

  /**
   * 更新 Marching Cubes 参数
   */
  updateMCParams() {
    const combined = new ArrayBuffer(16);
    new Float32Array(combined, 0, 1).set([this.params.isoValue]);
    new Uint32Array(combined, 4, 3).set(this.gridSize);
    this.device.queue.writeBuffer(this.mcParamsBuffer, 0, combined);
    this.device.queue.writeBuffer(this.gridMinBuffer, 0, new Float32Array([...this.params.gridMin, 0]));
    this.device.queue.writeBuffer(this.gridMaxBuffer, 0, new Float32Array([...this.params.gridMax, 0]));
  }

  /**
   * 创建绑定组
   */
  createBindGroups() {
    this.clearVoxelBindGroup = this.device.createBindGroup({
      label: "clearVoxel", 
      layout: this.clearVoxelPipeline.getBindGroupLayout(0), 
      entries: [
        { binding: 0, resource: { buffer: this.voxelBuffer } },
        { binding: 1, resource: { buffer: this.voxelColorsRBuffer } },
        { binding: 2, resource: { buffer: this.voxelColorsGBuffer } },
        { binding: 3, resource: { buffer: this.voxelColorsBBuffer } },
        { binding: 4, resource: { buffer: this.gridSizeBuffer } },
      ]
    });
    
    this.splatPointsBindGroup = this.device.createBindGroup({
      label: "splatPoints", 
      layout: this.splatPointsPipeline.getBindGroupLayout(0), 
      entries: [
        { binding: 0, resource: { buffer: this.pointsBuffer } },
        { binding: 1, resource: { buffer: this.colorsBuffer } },
        { binding: 2, resource: { buffer: this.voxelBuffer } },
        { binding: 3, resource: { buffer: this.voxelColorsRBuffer } },
        { binding: 4, resource: { buffer: this.voxelColorsGBuffer } },
        { binding: 5, resource: { buffer: this.voxelColorsBBuffer } },
        { binding: 6, resource: { buffer: this.gridSizeBuffer } },
        { binding: 7, resource: { buffer: this.numPointsBuffer } },
        { binding: 8, resource: { buffer: this.paramsBuffer } },
      ]
    });
    
    this.normalizeDensityBindGroup = this.device.createBindGroup({
      label: "normalizeDensity", 
      layout: this.normalizeDensityPipeline.getBindGroupLayout(0), 
      entries: [
        { binding: 0, resource: { buffer: this.voxelBuffer } },
        { binding: 1, resource: { buffer: this.densityBuffer } },
        { binding: 2, resource: { buffer: this.gridSizeBuffer } },
        { binding: 3, resource: { buffer: this.voxelColorsRBuffer } },
        { binding: 4, resource: { buffer: this.voxelColorsGBuffer } },
        { binding: 5, resource: { buffer: this.voxelColorsBBuffer } },
        { binding: 6, resource: { buffer: this.normalizedColorsBuffer } },
      ]
    });
    
    this.marchingCubesBindGroup = this.device.createBindGroup({
      label: "marchingCubes", 
      layout: this.marchingCubesPipeline.getBindGroupLayout(0), 
      entries: [
        { binding: 0, resource: { buffer: this.densityBuffer } },
        { binding: 1, resource: { buffer: this.vertexBuffer } },
        { binding: 2, resource: { buffer: this.triangleCountBuffer } },
        { binding: 3, resource: { buffer: this.mcParamsBuffer } },
        { binding: 4, resource: { buffer: this.edgeTableBuffer } },
        { binding: 5, resource: { buffer: this.triTableBuffer } },
        { binding: 6, resource: { buffer: this.gridMinBuffer } },
        { binding: 7, resource: { buffer: this.gridMaxBuffer } },
        { binding: 8, resource: { buffer: this.normalizedColorsBuffer } },
      ]
    });
  }

  /**
   * 执行网格重建
   * @returns {Promise<Object|null>} 重建结果，包含 positions, normals, colors, triangleCount
   */
  async reconstruct() {
    if (!this.initialized || !this.pointsBuffer) return null;
    const startTime = performance.now();
    this.updateSplatParams();
    this.updateMCParams();

    const gridCount = this.gridSize[0] * this.gridSize[1] * this.gridSize[2];
    const pointWorkgroups = Math.ceil(this.numPoints / 64);
    const gridWorkgroups = Math.ceil(gridCount / 64);
    this.device.queue.writeBuffer(this.triangleCountBuffer, 0, new Uint32Array([0]));

    const commandEncoder = this.device.createCommandEncoder();
    
    // Clear pass
    const clearPass = commandEncoder.beginComputePass();
    clearPass.setPipeline(this.clearVoxelPipeline);
    clearPass.setBindGroup(0, this.clearVoxelBindGroup);
    clearPass.dispatchWorkgroups(gridWorkgroups);
    clearPass.end();
    
    // Splat pass
    const splatPass = commandEncoder.beginComputePass();
    splatPass.setPipeline(this.splatPointsPipeline);
    splatPass.setBindGroup(0, this.splatPointsBindGroup);
    splatPass.dispatchWorkgroups(pointWorkgroups);
    splatPass.end();
    
    // Normalize pass
    const normalizePass = commandEncoder.beginComputePass();
    normalizePass.setPipeline(this.normalizeDensityPipeline);
    normalizePass.setBindGroup(0, this.normalizeDensityBindGroup);
    normalizePass.dispatchWorkgroups(gridWorkgroups);
    normalizePass.end();
    
    // Marching Cubes pass
    const mcPass = commandEncoder.beginComputePass();
    mcPass.setPipeline(this.marchingCubesPipeline);
    mcPass.setBindGroup(0, this.marchingCubesBindGroup);
    mcPass.dispatchWorkgroups(
      Math.ceil(this.gridSize[0] / 4), 
      Math.ceil(this.gridSize[1] / 4), 
      Math.ceil(this.gridSize[2] / 4)
    );
    mcPass.end();

    commandEncoder.copyBufferToBuffer(this.triangleCountBuffer, 0, this.countReadbackBuffer, 0, 4);
    this.device.queue.submit([commandEncoder.finish()]);

    await this.countReadbackBuffer.mapAsync(GPUMapMode.READ);
    const countData = new Uint32Array(this.countReadbackBuffer.getMappedRange().slice(0));
    this.countReadbackBuffer.unmap();
    this.triangleCount = Math.min(countData[0], this.maxTriangleCount || countData[0]);

    if (this.triangleCount === 0) {
      this.lastComputeTime = performance.now() - startTime;
      return { 
        positions: new Float32Array(0), 
        normals: new Float32Array(0), 
        colors: new Float32Array(0), 
        triangleCount: 0 
      };
    }

    // 读取顶点数据
    const actualTriangles = Math.min(this.triangleCount, this.maxTriangleCount || this.triangleCount);
    const vertexCount = actualTriangles * 3;
    const bytesPerVertex = 48;
    const readSize = Math.min(vertexCount * bytesPerVertex, this.readbackBuffer.size);

    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(this.vertexBuffer, 0, this.readbackBuffer, 0, readSize);
    this.device.queue.submit([copyEncoder.finish()]);

    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const vertexData = new Float32Array(this.readbackBuffer.getMappedRange(0, readSize).slice(0));
    this.readbackBuffer.unmap();

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = vertexData[i * 12];
      positions[i * 3 + 1] = vertexData[i * 12 + 1];
      positions[i * 3 + 2] = vertexData[i * 12 + 2];
      normals[i * 3] = vertexData[i * 12 + 4];
      normals[i * 3 + 1] = vertexData[i * 12 + 5];
      normals[i * 3 + 2] = vertexData[i * 12 + 6];
      colors[i * 3] = vertexData[i * 12 + 8];
      colors[i * 3 + 1] = vertexData[i * 12 + 9];
      colors[i * 3 + 2] = vertexData[i * 12 + 10];
    }

    this.lastComputeTime = performance.now() - startTime;
    return { positions, normals, colors, triangleCount: this.triangleCount };
  }

  /**
   * 销毁数据缓冲区
   */
  destroyBuffers() {
    const buffers = [
      'pointsBuffer', 'colorsBuffer', 'voxelBuffer', 
      'voxelColorsRBuffer', 'voxelColorsGBuffer', 'voxelColorsBBuffer', 
      'normalizedColorsBuffer', 'densityBuffer', 'vertexBuffer', 
      'triangleCountBuffer', 'readbackBuffer', 'countReadbackBuffer', 
      'paramsBuffer', 'mcParamsBuffer', 'gridSizeBuffer', 
      'numPointsBuffer', 'gridMinBuffer', 'gridMaxBuffer'
    ];
    buffers.forEach(name => { 
      if (this[name]) { 
        this[name].destroy(); 
        this[name] = null; 
      } 
    });
  }

  /**
   * 销毁所有资源
   */
  destroy() {
    this.destroyBuffers();
    if (this.edgeTableBuffer) { 
      this.edgeTableBuffer.destroy(); 
      this.edgeTableBuffer = null; 
    }
    if (this.triTableBuffer) { 
      this.triTableBuffer.destroy(); 
      this.triTableBuffer = null; 
    }
  }
}

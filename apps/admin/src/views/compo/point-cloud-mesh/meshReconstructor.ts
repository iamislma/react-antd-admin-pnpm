/* eslint-disable no-plusplus, no-param-reassign, no-bitwise, no-console */
/**
 * GPU Marching Cubes 网格重建器
 * 使用 WebGPU Compute Shader 进行点云到网格的转换
 */

import { EDGE_TABLE, TRI_TABLE } from './marchingCubesTables';
import { clearVoxelShader, marchingCubesShader, normalizeDensityShader, splatPointsShader } from './wgslShaders';

export interface ReconstructParams {
  isoValue: number;
  splatRadius: number;
  gridMin: [number, number, number];
  gridMax: [number, number, number];
}

export interface ReconstructResult {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  triangleCount: number;
}

/**
 * MeshReconstructor 类
 * 负责使用 GPU 进行 Marching Cubes 网格重建
 */
export class MeshReconstructor {
  private device: GPUDevice | null = null;

  private initialized = false;

  private numPoints = 0;

  private gridSize: [number, number, number] = [64, 64, 64];

  public triangleCount = 0;

  public params: ReconstructParams = {
    isoValue: 0.5,
    splatRadius: 1.5,
    gridMin: [-60, -60, -60],
    gridMax: [60, 60, 60],
  };

  public lastComputeTime = 0;

  private maxBufferSize = 0;

  private maxTriangleCount = 0;

  // GPU 缓冲区
  private pointsBuffer: GPUBuffer | null = null;

  private colorsBuffer: GPUBuffer | null = null;

  private voxelBuffer: GPUBuffer | null = null;

  private voxelColorsRBuffer: GPUBuffer | null = null;

  private voxelColorsGBuffer: GPUBuffer | null = null;

  private voxelColorsBBuffer: GPUBuffer | null = null;

  private normalizedColorsBuffer: GPUBuffer | null = null;

  private densityBuffer: GPUBuffer | null = null;

  private vertexBuffer: GPUBuffer | null = null;

  private triangleCountBuffer: GPUBuffer | null = null;

  private readbackBuffer: GPUBuffer | null = null;

  private countReadbackBuffer: GPUBuffer | null = null;

  private paramsBuffer: GPUBuffer | null = null;

  private mcParamsBuffer: GPUBuffer | null = null;

  private gridSizeBuffer: GPUBuffer | null = null;

  private numPointsBuffer: GPUBuffer | null = null;

  private gridMinBuffer: GPUBuffer | null = null;

  private gridMaxBuffer: GPUBuffer | null = null;

  private edgeTableBuffer: GPUBuffer | null = null;

  private triTableBuffer: GPUBuffer | null = null;

  // 着色器模块
  private clearVoxelModule: GPUShaderModule | null = null;

  private splatPointsModule: GPUShaderModule | null = null;

  private normalizeDensityModule: GPUShaderModule | null = null;

  private marchingCubesModule: GPUShaderModule | null = null;

  // 计算管线
  private clearVoxelPipeline: GPUComputePipeline | null = null;

  private splatPointsPipeline: GPUComputePipeline | null = null;

  private normalizeDensityPipeline: GPUComputePipeline | null = null;

  private marchingCubesPipeline: GPUComputePipeline | null = null;

  // 绑定组
  private clearVoxelBindGroup: GPUBindGroup | null = null;

  private splatPointsBindGroup: GPUBindGroup | null = null;

  private normalizeDensityBindGroup: GPUBindGroup | null = null;

  private marchingCubesBindGroup: GPUBindGroup | null = null;

  /**
   * 初始化 WebGPU 设备和管线
   */
  async init(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn('WebGPU not supported for mesh reconstruction');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;

      const adapterLimits = adapter.limits;
      const maxBufferSize = Math.min(adapterLimits.maxBufferSize, 1024 * 1024 * 1024);
      const maxStorageBufferBindingSize = Math.min(adapterLimits.maxStorageBufferBindingSize, 1024 * 1024 * 1024);

      this.device = await adapter.requestDevice({
        requiredLimits: { maxBufferSize, maxStorageBufferBindingSize },
      });
      this.maxBufferSize = this.device.limits.maxBufferSize;

      this.createShaderModules();
      this.createPipelines();

      this.initialized = true;
      console.log('MeshReconstructor WebGPU initialized');
      return true;
    } catch (e) {
      console.error('MeshReconstructor init failed:', e);
      return false;
    }
  }

  /** 创建着色器模块 */
  private createShaderModules(): void {
    if (!this.device) return;
    this.clearVoxelModule = this.device.createShaderModule({ code: clearVoxelShader, label: 'clearVoxel' });
    this.splatPointsModule = this.device.createShaderModule({ code: splatPointsShader, label: 'splatPoints' });
    this.normalizeDensityModule = this.device.createShaderModule({
      code: normalizeDensityShader,
      label: 'normalizeDensity',
    });
    this.marchingCubesModule = this.device.createShaderModule({ code: marchingCubesShader, label: 'marchingCubes' });
  }

  /** 创建计算管线 */
  private createPipelines(): void {
    if (!this.device) return;
    this.clearVoxelPipeline = this.device.createComputePipeline({
      label: 'clearVoxel',
      layout: 'auto',
      compute: { module: this.clearVoxelModule!, entryPoint: 'main' },
    });
    this.splatPointsPipeline = this.device.createComputePipeline({
      label: 'splatPoints',
      layout: 'auto',
      compute: { module: this.splatPointsModule!, entryPoint: 'main' },
    });
    this.normalizeDensityPipeline = this.device.createComputePipeline({
      label: 'normalizeDensity',
      layout: 'auto',
      compute: { module: this.normalizeDensityModule!, entryPoint: 'main' },
    });
    this.marchingCubesPipeline = this.device.createComputePipeline({
      label: 'marchingCubes',
      layout: 'auto',
      compute: { module: this.marchingCubesModule!, entryPoint: 'main' },
    });
  }

  /**
   * 设置点云数据
   */
  setPointCloud(positions: Float32Array, colors: Float32Array | null, count: number, gridRes: number): void {
    if (!this.initialized || !this.device) return;
    this.destroyBuffers();
    this.numPoints = count;
    this.gridSize = [gridRes, gridRes, gridRes];
    const gridCount = gridRes * gridRes * gridRes;

    // 计算包围盒
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
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
      label: 'points',
      size: count * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
      label: 'colors',
      size: count * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorsBuffer, 0, colorData);

    // 体素缓冲区
    this.voxelBuffer = this.device.createBuffer({
      label: 'voxel',
      size: gridCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.voxelColorsRBuffer = this.device.createBuffer({
      label: 'voxelR',
      size: gridCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.voxelColorsGBuffer = this.device.createBuffer({
      label: 'voxelG',
      size: gridCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.voxelColorsBBuffer = this.device.createBuffer({
      label: 'voxelB',
      size: gridCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.normalizedColorsBuffer = this.device.createBuffer({
      label: 'normalizedColors',
      size: gridCount * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.densityBuffer = this.device.createBuffer({
      label: 'density',
      size: gridCount * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    // 顶点输出
    const surfaceVoxels = 6 * gridRes * gridRes * 2;
    const maxTriangles = Math.min(surfaceVoxels * 5, gridCount);
    const maxVertices = maxTriangles * 3;
    const bytesPerVertex = 48;
    const vertexBufferSize = maxVertices * bytesPerVertex;

    const maxAllowedSize = Math.min(this.maxBufferSize, 512 * 1024 * 1024);
    const actualBufferSize = Math.min(vertexBufferSize, maxAllowedSize);

    this.vertexBuffer = this.device.createBuffer({
      label: 'vertices',
      size: actualBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.triangleCountBuffer = this.device.createBuffer({
      label: 'triCount',
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.readbackBuffer = this.device.createBuffer({
      label: 'readback',
      size: actualBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.maxTriangleCount = Math.floor(actualBufferSize / bytesPerVertex / 3);
    this.countReadbackBuffer = this.device.createBuffer({
      label: 'countReadback',
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Uniform 缓冲区
    this.gridSizeBuffer = this.device.createBuffer({
      label: 'gridSize',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridSizeBuffer, 0, new Uint32Array([...this.gridSize, 0]));

    this.numPointsBuffer = this.device.createBuffer({
      label: 'numPoints',
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.numPointsBuffer, 0, new Uint32Array([count]));

    this.paramsBuffer = this.device.createBuffer({
      label: 'splatParams',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.mcParamsBuffer = this.device.createBuffer({
      label: 'mcParams',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gridMinBuffer = this.device.createBuffer({
      label: 'gridMin',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gridMaxBuffer = this.device.createBuffer({
      label: 'gridMax',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 查找表
    this.edgeTableBuffer = this.device.createBuffer({
      label: 'edgeTable',
      size: EDGE_TABLE.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.edgeTableBuffer, 0, EDGE_TABLE);

    this.triTableBuffer = this.device.createBuffer({
      label: 'triTable',
      size: TRI_TABLE.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.triTableBuffer, 0, new Int32Array(TRI_TABLE));

    this.createBindGroups();
  }

  /** 更新 Splat 参数 */
  private updateSplatParams(): void {
    if (!this.device || !this.paramsBuffer) return;
    const data = new Float32Array([
      ...this.params.gridMin,
      0,
      ...this.params.gridMax,
      0,
      this.params.splatRadius,
      0,
      0,
      0,
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
  }

  /** 更新 Marching Cubes 参数 */
  private updateMCParams(): void {
    if (!this.device || !this.mcParamsBuffer || !this.gridMinBuffer || !this.gridMaxBuffer) return;
    const combined = new ArrayBuffer(16);
    new Float32Array(combined, 0, 1).set([this.params.isoValue]);
    new Uint32Array(combined, 4, 3).set(this.gridSize);
    this.device.queue.writeBuffer(this.mcParamsBuffer, 0, combined);
    this.device.queue.writeBuffer(this.gridMinBuffer, 0, new Float32Array([...this.params.gridMin, 0]));
    this.device.queue.writeBuffer(this.gridMaxBuffer, 0, new Float32Array([...this.params.gridMax, 0]));
  }

  /** 创建绑定组 */
  private createBindGroups(): void {
    if (!this.device) return;
    this.clearVoxelBindGroup = this.device.createBindGroup({
      label: 'clearVoxel',
      layout: this.clearVoxelPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.voxelBuffer! } },
        { binding: 1, resource: { buffer: this.voxelColorsRBuffer! } },
        { binding: 2, resource: { buffer: this.voxelColorsGBuffer! } },
        { binding: 3, resource: { buffer: this.voxelColorsBBuffer! } },
        { binding: 4, resource: { buffer: this.gridSizeBuffer! } },
      ],
    });

    this.splatPointsBindGroup = this.device.createBindGroup({
      label: 'splatPoints',
      layout: this.splatPointsPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.pointsBuffer! } },
        { binding: 1, resource: { buffer: this.colorsBuffer! } },
        { binding: 2, resource: { buffer: this.voxelBuffer! } },
        { binding: 3, resource: { buffer: this.voxelColorsRBuffer! } },
        { binding: 4, resource: { buffer: this.voxelColorsGBuffer! } },
        { binding: 5, resource: { buffer: this.voxelColorsBBuffer! } },
        { binding: 6, resource: { buffer: this.gridSizeBuffer! } },
        { binding: 7, resource: { buffer: this.numPointsBuffer! } },
        { binding: 8, resource: { buffer: this.paramsBuffer! } },
      ],
    });

    this.normalizeDensityBindGroup = this.device.createBindGroup({
      label: 'normalizeDensity',
      layout: this.normalizeDensityPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.voxelBuffer! } },
        { binding: 1, resource: { buffer: this.densityBuffer! } },
        { binding: 2, resource: { buffer: this.gridSizeBuffer! } },
        { binding: 3, resource: { buffer: this.voxelColorsRBuffer! } },
        { binding: 4, resource: { buffer: this.voxelColorsGBuffer! } },
        { binding: 5, resource: { buffer: this.voxelColorsBBuffer! } },
        { binding: 6, resource: { buffer: this.normalizedColorsBuffer! } },
      ],
    });

    this.marchingCubesBindGroup = this.device.createBindGroup({
      label: 'marchingCubes',
      layout: this.marchingCubesPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.densityBuffer! } },
        { binding: 1, resource: { buffer: this.vertexBuffer! } },
        { binding: 2, resource: { buffer: this.triangleCountBuffer! } },
        { binding: 3, resource: { buffer: this.mcParamsBuffer! } },
        { binding: 4, resource: { buffer: this.edgeTableBuffer! } },
        { binding: 5, resource: { buffer: this.triTableBuffer! } },
        { binding: 6, resource: { buffer: this.gridMinBuffer! } },
        { binding: 7, resource: { buffer: this.gridMaxBuffer! } },
        { binding: 8, resource: { buffer: this.normalizedColorsBuffer! } },
      ],
    });
  }

  /**
   * 执行网格重建
   */
  async reconstruct(): Promise<ReconstructResult | null> {
    if (!this.initialized || !this.pointsBuffer || !this.device) return null;
    const startTime = performance.now();
    this.updateSplatParams();
    this.updateMCParams();

    const gridCount = this.gridSize[0] * this.gridSize[1] * this.gridSize[2];
    const pointWorkgroups = Math.ceil(this.numPoints / 64);
    const gridWorkgroups = Math.ceil(gridCount / 64);
    this.device.queue.writeBuffer(this.triangleCountBuffer!, 0, new Uint32Array([0]));

    const commandEncoder = this.device.createCommandEncoder();

    // Clear
    const clearPass = commandEncoder.beginComputePass();
    clearPass.setPipeline(this.clearVoxelPipeline!);
    clearPass.setBindGroup(0, this.clearVoxelBindGroup!);
    clearPass.dispatchWorkgroups(gridWorkgroups);
    clearPass.end();

    // Splat
    const splatPass = commandEncoder.beginComputePass();
    splatPass.setPipeline(this.splatPointsPipeline!);
    splatPass.setBindGroup(0, this.splatPointsBindGroup!);
    splatPass.dispatchWorkgroups(pointWorkgroups);
    splatPass.end();

    // Normalize
    const normalizePass = commandEncoder.beginComputePass();
    normalizePass.setPipeline(this.normalizeDensityPipeline!);
    normalizePass.setBindGroup(0, this.normalizeDensityBindGroup!);
    normalizePass.dispatchWorkgroups(gridWorkgroups);
    normalizePass.end();

    // Marching Cubes
    const mcPass = commandEncoder.beginComputePass();
    mcPass.setPipeline(this.marchingCubesPipeline!);
    mcPass.setBindGroup(0, this.marchingCubesBindGroup!);
    mcPass.dispatchWorkgroups(
      Math.ceil(this.gridSize[0] / 4),
      Math.ceil(this.gridSize[1] / 4),
      Math.ceil(this.gridSize[2] / 4),
    );
    mcPass.end();

    commandEncoder.copyBufferToBuffer(this.triangleCountBuffer!, 0, this.countReadbackBuffer!, 0, 4);
    this.device.queue.submit([commandEncoder.finish()]);

    await this.countReadbackBuffer!.mapAsync(GPUMapMode.READ);
    const countData = new Uint32Array(this.countReadbackBuffer!.getMappedRange().slice(0));
    this.countReadbackBuffer!.unmap();
    this.triangleCount = Math.min(countData[0], this.maxTriangleCount || countData[0]);

    if (this.triangleCount === 0) {
      this.lastComputeTime = performance.now() - startTime;
      return {
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        colors: new Float32Array(0),
        triangleCount: 0,
      };
    }

    const actualTriangles = Math.min(this.triangleCount, this.maxTriangleCount || this.triangleCount);
    const vertexCount = actualTriangles * 3;
    const bytesPerVertex = 48;
    const readSize = Math.min(vertexCount * bytesPerVertex, this.readbackBuffer!.size);

    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(this.vertexBuffer!, 0, this.readbackBuffer!, 0, readSize);
    this.device.queue.submit([copyEncoder.finish()]);

    await this.readbackBuffer!.mapAsync(GPUMapMode.READ);
    const vertexData = new Float32Array(this.readbackBuffer!.getMappedRange(0, readSize).slice(0));
    this.readbackBuffer!.unmap();

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

  /** 销毁数据缓冲区 */
  destroyBuffers(): void {
    const buffers: (GPUBuffer | null)[] = [
      this.pointsBuffer,
      this.colorsBuffer,
      this.voxelBuffer,
      this.voxelColorsRBuffer,
      this.voxelColorsGBuffer,
      this.voxelColorsBBuffer,
      this.normalizedColorsBuffer,
      this.densityBuffer,
      this.vertexBuffer,
      this.triangleCountBuffer,
      this.readbackBuffer,
      this.countReadbackBuffer,
      this.paramsBuffer,
      this.mcParamsBuffer,
      this.gridSizeBuffer,
      this.numPointsBuffer,
      this.gridMinBuffer,
      this.gridMaxBuffer,
    ];
    buffers.forEach((buffer) => {
      if (buffer) {
        buffer.destroy();
      }
    });
    this.pointsBuffer = null;
    this.colorsBuffer = null;
    this.voxelBuffer = null;
    this.voxelColorsRBuffer = null;
    this.voxelColorsGBuffer = null;
    this.voxelColorsBBuffer = null;
    this.normalizedColorsBuffer = null;
    this.densityBuffer = null;
    this.vertexBuffer = null;
    this.triangleCountBuffer = null;
    this.readbackBuffer = null;
    this.countReadbackBuffer = null;
    this.paramsBuffer = null;
    this.mcParamsBuffer = null;
    this.gridSizeBuffer = null;
    this.numPointsBuffer = null;
    this.gridMinBuffer = null;
    this.gridMaxBuffer = null;
  }

  /** 完全销毁重建器 */
  destroy(): void {
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

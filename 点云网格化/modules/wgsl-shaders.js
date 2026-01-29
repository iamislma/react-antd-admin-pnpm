/**
 * WGSL Compute Shaders for Marching Cubes mesh reconstruction
 * 包含体素清除、点云散射、密度归一化和Marching Cubes计算着色器
 */

// 清除体素着色器
export const clearVoxelShader = /* wgsl */ `
  @group(0) @binding(0) var<storage, read_write> voxelDensity: array<atomic<u32>>;
  @group(0) @binding(1) var<storage, read_write> voxelColorsR: array<atomic<u32>>;
  @group(0) @binding(2) var<storage, read_write> voxelColorsG: array<atomic<u32>>;
  @group(0) @binding(3) var<storage, read_write> voxelColorsB: array<atomic<u32>>;
  @group(0) @binding(4) var<uniform> gridSize: vec3<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    let totalVoxels = gridSize.x * gridSize.y * gridSize.z;
    if (idx >= totalVoxels) { return; }
    atomicStore(&voxelDensity[idx], 0u);
    atomicStore(&voxelColorsR[idx], 0u);
    atomicStore(&voxelColorsG[idx], 0u);
    atomicStore(&voxelColorsB[idx], 0u);
  }
`;

// 点云散射着色器 (Point-to-Grid Splatting)
export const splatPointsShader = /* wgsl */ `
  @group(0) @binding(0) var<storage, read> points: array<vec4<f32>>;
  @group(0) @binding(1) var<storage, read> colors: array<vec4<f32>>;
  @group(0) @binding(2) var<storage, read_write> voxelDensity: array<atomic<u32>>;
  @group(0) @binding(3) var<storage, read_write> voxelColorsR: array<atomic<u32>>;
  @group(0) @binding(4) var<storage, read_write> voxelColorsG: array<atomic<u32>>;
  @group(0) @binding(5) var<storage, read_write> voxelColorsB: array<atomic<u32>>;
  @group(0) @binding(6) var<uniform> gridSize: vec3<u32>;
  @group(0) @binding(7) var<uniform> numPoints: u32;
  @group(0) @binding(8) var<uniform> params: SplatParams;

  struct SplatParams {
    gridMin: vec3<f32>,
    pad0: f32,
    gridMax: vec3<f32>,
    pad1: f32,
    splatRadius: f32,
    pad2: f32,
    pad3: f32,
    pad4: f32,
  };

  fn voxelIndex(x: u32, y: u32, z: u32) -> u32 {
    return x + y * gridSize.x + z * gridSize.x * gridSize.y;
  }

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let pointIdx = id.x;
    if (pointIdx >= numPoints) { return; }

    let pos = points[pointIdx].xyz;
    let color = colors[pointIdx].xyz;
    let gridExtent = params.gridMax - params.gridMin;
    let cellSize = gridExtent / vec3<f32>(gridSize);
    let relPos = (pos - params.gridMin) / gridExtent;
    let gridPos = relPos * vec3<f32>(gridSize);
    let radius = params.splatRadius;
    let radiusCells = i32(ceil(radius / min(cellSize.x, min(cellSize.y, cellSize.z))));

    let centerCell = vec3<i32>(floor(gridPos));

    for (var dz = -radiusCells; dz <= radiusCells; dz++) {
      for (var dy = -radiusCells; dy <= radiusCells; dy++) {
        for (var dx = -radiusCells; dx <= radiusCells; dx++) {
          let cell = centerCell + vec3<i32>(dx, dy, dz);

          if (cell.x < 0 || cell.x >= i32(gridSize.x) ||
              cell.y < 0 || cell.y >= i32(gridSize.y) ||
              cell.z < 0 || cell.z >= i32(gridSize.z)) {
            continue;
          }

          let cellCenter = (vec3<f32>(cell) + 0.5) * cellSize + params.gridMin;
          let dist = length(pos - cellCenter);
          
          if (dist > radius) { continue; }

          let weight = exp(-0.5 * (dist / (radius * 0.5)) * (dist / (radius * 0.5)));
          let quantizedWeight = u32(weight * 1000.0);
          
          if (quantizedWeight == 0u) { continue; }

          let idx = voxelIndex(u32(cell.x), u32(cell.y), u32(cell.z));
          atomicAdd(&voxelDensity[idx], quantizedWeight);
          atomicAdd(&voxelColorsR[idx], u32(color.x * f32(quantizedWeight)));
          atomicAdd(&voxelColorsG[idx], u32(color.y * f32(quantizedWeight)));
          atomicAdd(&voxelColorsB[idx], u32(color.z * f32(quantizedWeight)));
        }
      }
    }
  }
`;

// 归一化密度和颜色着色器
export const normalizeDensityShader = /* wgsl */ `
  @group(0) @binding(0) var<storage, read_write> voxelDensityRaw: array<atomic<u32>>;
  @group(0) @binding(1) var<storage, read_write> voxelDensity: array<f32>;
  @group(0) @binding(2) var<uniform> gridSize: vec3<u32>;
  @group(0) @binding(3) var<storage, read_write> voxelColorsR: array<atomic<u32>>;
  @group(0) @binding(4) var<storage, read_write> voxelColorsG: array<atomic<u32>>;
  @group(0) @binding(5) var<storage, read_write> voxelColorsB: array<atomic<u32>>;
  @group(0) @binding(6) var<storage, read_write> normalizedColors: array<vec4<f32>>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    let totalVoxels = gridSize.x * gridSize.y * gridSize.z;
    if (idx >= totalVoxels) { return; }

    let rawDensity = f32(atomicLoad(&voxelDensityRaw[idx])) / 1000.0;
    let normalizedDensity = 1.0 - exp(-rawDensity * 0.5);
    voxelDensity[idx] = normalizedDensity;
    
    if (rawDensity > 0.001) {
      let r = f32(atomicLoad(&voxelColorsR[idx])) / rawDensity / 1000.0;
      let g = f32(atomicLoad(&voxelColorsG[idx])) / rawDensity / 1000.0;
      let b = f32(atomicLoad(&voxelColorsB[idx])) / rawDensity / 1000.0;
      normalizedColors[idx] = vec4<f32>(r, g, b, 1.0);
    } else {
      normalizedColors[idx] = vec4<f32>(0.5, 0.5, 0.5, 1.0);
    }
  }
`;

// Marching Cubes 着色器
export const marchingCubesShader = /* wgsl */ `
  @group(0) @binding(0) var<storage, read> density: array<f32>;
  @group(0) @binding(1) var<storage, read_write> vertices: array<Vertex>;
  @group(0) @binding(2) var<storage, read_write> triangleCount: atomic<u32>;
  @group(0) @binding(3) var<uniform> params: MCParams;
  @group(0) @binding(4) var<storage, read> edgeTable: array<u32>;
  @group(0) @binding(5) var<storage, read> triTable: array<i32>;
  @group(0) @binding(6) var<uniform> gridMin: vec4<f32>;
  @group(0) @binding(7) var<uniform> gridMax: vec4<f32>;
  @group(0) @binding(8) var<storage, read> voxelColors: array<vec4<f32>>;

  struct MCParams {
    isoValue: f32,
    gridSizeX: u32,
    gridSizeY: u32,
    gridSizeZ: u32,
  };

  struct Vertex {
    position: vec3<f32>,
    pad0: f32,
    normal: vec3<f32>,
    pad1: f32,
    color: vec3<f32>,
    pad2: f32,
  };

  fn voxelIndex(x: u32, y: u32, z: u32) -> u32 {
    return x + y * params.gridSizeX + z * params.gridSizeX * params.gridSizeY;
  }

  fn worldPos(x: u32, y: u32, z: u32) -> vec3<f32> {
    let gridSize = vec3<f32>(f32(params.gridSizeX), f32(params.gridSizeY), f32(params.gridSizeZ));
    let t = vec3<f32>(f32(x), f32(y), f32(z)) / (gridSize - 1.0);
    return mix(gridMin.xyz, gridMax.xyz, t);
  }

  fn interpolateVertex(p1: vec3<f32>, p2: vec3<f32>, v1: f32, v2: f32) -> vec3<f32> {
    if (abs(params.isoValue - v1) < 0.00001) { return p1; }
    if (abs(params.isoValue - v2) < 0.00001) { return p2; }
    if (abs(v1 - v2) < 0.00001) { return p1; }
    let t = (params.isoValue - v1) / (v2 - v1);
    return mix(p1, p2, t);
  }

  fn interpolateColor(c1: vec3<f32>, c2: vec3<f32>, v1: f32, v2: f32) -> vec3<f32> {
    if (abs(v1 - v2) < 0.00001) { return c1; }
    let t = (params.isoValue - v1) / (v2 - v1);
    return mix(c1, c2, t);
  }

  @compute @workgroup_size(4, 4, 4)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let x = id.x;
    let y = id.y;
    let z = id.z;

    if (x >= params.gridSizeX - 1u || y >= params.gridSizeY - 1u || z >= params.gridSizeZ - 1u) { return; }

    // 8个角点的密度值
    var cornerDensity: array<f32, 8>;
    cornerDensity[0] = density[voxelIndex(x, y, z)];
    cornerDensity[1] = density[voxelIndex(x + 1u, y, z)];
    cornerDensity[2] = density[voxelIndex(x + 1u, y + 1u, z)];
    cornerDensity[3] = density[voxelIndex(x, y + 1u, z)];
    cornerDensity[4] = density[voxelIndex(x, y, z + 1u)];
    cornerDensity[5] = density[voxelIndex(x + 1u, y, z + 1u)];
    cornerDensity[6] = density[voxelIndex(x + 1u, y + 1u, z + 1u)];
    cornerDensity[7] = density[voxelIndex(x, y + 1u, z + 1u)];

    // 计算 cube index
    var cubeIndex = 0u;
    for (var i = 0u; i < 8u; i++) {
      if (cornerDensity[i] < params.isoValue) {
        cubeIndex |= (1u << i);
      }
    }

    if (edgeTable[cubeIndex] == 0u) { return; }

    // 8个角点的位置和颜色
    var cornerPos: array<vec3<f32>, 8>;
    var cornerColor: array<vec3<f32>, 8>;
    cornerPos[0] = worldPos(x, y, z);
    cornerPos[1] = worldPos(x + 1u, y, z);
    cornerPos[2] = worldPos(x + 1u, y + 1u, z);
    cornerPos[3] = worldPos(x, y + 1u, z);
    cornerPos[4] = worldPos(x, y, z + 1u);
    cornerPos[5] = worldPos(x + 1u, y, z + 1u);
    cornerPos[6] = worldPos(x + 1u, y + 1u, z + 1u);
    cornerPos[7] = worldPos(x, y + 1u, z + 1u);
    
    cornerColor[0] = voxelColors[voxelIndex(x, y, z)].xyz;
    cornerColor[1] = voxelColors[voxelIndex(x + 1u, y, z)].xyz;
    cornerColor[2] = voxelColors[voxelIndex(x + 1u, y + 1u, z)].xyz;
    cornerColor[3] = voxelColors[voxelIndex(x, y + 1u, z)].xyz;
    cornerColor[4] = voxelColors[voxelIndex(x, y, z + 1u)].xyz;
    cornerColor[5] = voxelColors[voxelIndex(x + 1u, y, z + 1u)].xyz;
    cornerColor[6] = voxelColors[voxelIndex(x + 1u, y + 1u, z + 1u)].xyz;
    cornerColor[7] = voxelColors[voxelIndex(x, y + 1u, z + 1u)].xyz;

    // 12条边的顶点插值
    var vertList: array<vec3<f32>, 12>;
    var colorList: array<vec3<f32>, 12>;
    let edges = edgeTable[cubeIndex];

    if ((edges & 1u) != 0u) { vertList[0] = interpolateVertex(cornerPos[0], cornerPos[1], cornerDensity[0], cornerDensity[1]); colorList[0] = interpolateColor(cornerColor[0], cornerColor[1], cornerDensity[0], cornerDensity[1]); }
    if ((edges & 2u) != 0u) { vertList[1] = interpolateVertex(cornerPos[1], cornerPos[2], cornerDensity[1], cornerDensity[2]); colorList[1] = interpolateColor(cornerColor[1], cornerColor[2], cornerDensity[1], cornerDensity[2]); }
    if ((edges & 4u) != 0u) { vertList[2] = interpolateVertex(cornerPos[2], cornerPos[3], cornerDensity[2], cornerDensity[3]); colorList[2] = interpolateColor(cornerColor[2], cornerColor[3], cornerDensity[2], cornerDensity[3]); }
    if ((edges & 8u) != 0u) { vertList[3] = interpolateVertex(cornerPos[3], cornerPos[0], cornerDensity[3], cornerDensity[0]); colorList[3] = interpolateColor(cornerColor[3], cornerColor[0], cornerDensity[3], cornerDensity[0]); }
    if ((edges & 16u) != 0u) { vertList[4] = interpolateVertex(cornerPos[4], cornerPos[5], cornerDensity[4], cornerDensity[5]); colorList[4] = interpolateColor(cornerColor[4], cornerColor[5], cornerDensity[4], cornerDensity[5]); }
    if ((edges & 32u) != 0u) { vertList[5] = interpolateVertex(cornerPos[5], cornerPos[6], cornerDensity[5], cornerDensity[6]); colorList[5] = interpolateColor(cornerColor[5], cornerColor[6], cornerDensity[5], cornerDensity[6]); }
    if ((edges & 64u) != 0u) { vertList[6] = interpolateVertex(cornerPos[6], cornerPos[7], cornerDensity[6], cornerDensity[7]); colorList[6] = interpolateColor(cornerColor[6], cornerColor[7], cornerDensity[6], cornerDensity[7]); }
    if ((edges & 128u) != 0u) { vertList[7] = interpolateVertex(cornerPos[7], cornerPos[4], cornerDensity[7], cornerDensity[4]); colorList[7] = interpolateColor(cornerColor[7], cornerColor[4], cornerDensity[7], cornerDensity[4]); }
    if ((edges & 256u) != 0u) { vertList[8] = interpolateVertex(cornerPos[0], cornerPos[4], cornerDensity[0], cornerDensity[4]); colorList[8] = interpolateColor(cornerColor[0], cornerColor[4], cornerDensity[0], cornerDensity[4]); }
    if ((edges & 512u) != 0u) { vertList[9] = interpolateVertex(cornerPos[1], cornerPos[5], cornerDensity[1], cornerDensity[5]); colorList[9] = interpolateColor(cornerColor[1], cornerColor[5], cornerDensity[1], cornerDensity[5]); }
    if ((edges & 1024u) != 0u) { vertList[10] = interpolateVertex(cornerPos[2], cornerPos[6], cornerDensity[2], cornerDensity[6]); colorList[10] = interpolateColor(cornerColor[2], cornerColor[6], cornerDensity[2], cornerDensity[6]); }
    if ((edges & 2048u) != 0u) { vertList[11] = interpolateVertex(cornerPos[3], cornerPos[7], cornerDensity[3], cornerDensity[7]); colorList[11] = interpolateColor(cornerColor[3], cornerColor[7], cornerDensity[3], cornerDensity[7]); }

    // 生成三角形
    let tableOffset = cubeIndex * 16u;
    for (var i = 0u; i < 16u; i += 3u) {
      let idx0 = triTable[tableOffset + i];
      if (idx0 < 0) { break; }
      let idx1 = triTable[tableOffset + i + 1u];
      let idx2 = triTable[tableOffset + i + 2u];

      let v0 = vertList[idx0];
      let v1 = vertList[idx1];
      let v2 = vertList[idx2];
      let c0 = colorList[idx0];
      let c1 = colorList[idx1];
      let c2 = colorList[idx2];
      
      let edge1 = v1 - v0;
      let edge2 = v2 - v0;
      let faceNormal = cross(edge1, edge2);
      
      if (length(faceNormal) < 0.0001) { continue; }
      
      let normal = normalize(faceNormal);
      
      let triIdx = atomicAdd(&triangleCount, 1u);
      let baseIdx = triIdx * 3u;
      
      if (baseIdx + 2u < arrayLength(&vertices)) {
        vertices[baseIdx].position = v0;
        vertices[baseIdx].normal = normal;
        vertices[baseIdx].color = c0;
        vertices[baseIdx + 1u].position = v1;
        vertices[baseIdx + 1u].normal = normal;
        vertices[baseIdx + 1u].color = c1;
        vertices[baseIdx + 2u].position = v2;
        vertices[baseIdx + 2u].normal = normal;
        vertices[baseIdx + 2u].color = c2;
      }
    }
  }
`;

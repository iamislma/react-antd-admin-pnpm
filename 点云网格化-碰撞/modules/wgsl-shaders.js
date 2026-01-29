/**
 * WGSL Compute Shaders for Marching Cubes mesh reconstruction
 * 用于点云转网格的 GPU 计算着色器
 */

// 清除体素密度场和颜色场
export const clearVoxelShader = /* wgsl */`
  @group(0) @binding(0) var<storage, read_write> voxels: array<atomic<i32>>;
  @group(0) @binding(1) var<storage, read_write> voxelColorsR: array<atomic<i32>>;
  @group(0) @binding(2) var<storage, read_write> voxelColorsG: array<atomic<i32>>;
  @group(0) @binding(3) var<storage, read_write> voxelColorsB: array<atomic<i32>>;
  @group(0) @binding(4) var<uniform> gridSize: vec3u;
  
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let gridCount = gridSize.x * gridSize.y * gridSize.z;
    if (id.x < gridCount) {
      atomicStore(&voxels[id.x], 0);
      atomicStore(&voxelColorsR[id.x], 0);
      atomicStore(&voxelColorsG[id.x], 0);
      atomicStore(&voxelColorsB[id.x], 0);
    }
  }
`;

// 点云散射到体素网格 (P2G - Point to Grid)
export const splatPointsShader = /* wgsl */`
  @group(0) @binding(0) var<storage, read> points: array<vec4f>;
  @group(0) @binding(1) var<storage, read> colors: array<vec4f>;
  @group(0) @binding(2) var<storage, read_write> voxels: array<atomic<i32>>;
  @group(0) @binding(3) var<storage, read_write> voxelColorsR: array<atomic<i32>>;
  @group(0) @binding(4) var<storage, read_write> voxelColorsG: array<atomic<i32>>;
  @group(0) @binding(5) var<storage, read_write> voxelColorsB: array<atomic<i32>>;
  @group(0) @binding(6) var<uniform> gridSize: vec3u;
  @group(0) @binding(7) var<uniform> numPoints: u32;
  @group(0) @binding(8) var<uniform> params: SplatParams;
  
  struct SplatParams {
    gridMin: vec3f,
    _pad0: f32,
    gridMax: vec3f,
    _pad1: f32,
    splatRadius: f32,
    _pad2: f32,
    _pad3: f32,
    _pad4: f32,
  }
  
  const FP_SCALE: f32 = 10000.0;
  const COLOR_SCALE: f32 = 1000.0;
  
  fn gaussianWeight(dist: f32, radius: f32) -> f32 {
    let sigma = radius * 0.5;
    return exp(-dist * dist / (2.0 * sigma * sigma));
  }
  
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= numPoints) { return; }
    
    let pos = points[id.x].xyz;
    let color = colors[id.x].xyz;
    
    let gridRange = params.gridMax - params.gridMin;
    let normalizedPos = (pos - params.gridMin) / gridRange;
    let gridPos = normalizedPos * vec3f(f32(gridSize.x), f32(gridSize.y), f32(gridSize.z));
    
    let cellRadius = i32(ceil(params.splatRadius));
    let centerCell = vec3i(floor(gridPos));
    
    for (var dx = -cellRadius; dx <= cellRadius; dx++) {
      for (var dy = -cellRadius; dy <= cellRadius; dy++) {
        for (var dz = -cellRadius; dz <= cellRadius; dz++) {
          let cellCoord = centerCell + vec3i(dx, dy, dz);
          
          if (cellCoord.x < 0 || cellCoord.x >= i32(gridSize.x) ||
              cellCoord.y < 0 || cellCoord.y >= i32(gridSize.y) ||
              cellCoord.z < 0 || cellCoord.z >= i32(gridSize.z)) {
            continue;
          }
          
          let cellCenter = vec3f(f32(cellCoord.x) + 0.5, f32(cellCoord.y) + 0.5, f32(cellCoord.z) + 0.5);
          let dist = length(gridPos - cellCenter);
          
          if (dist > params.splatRadius) { continue; }
          
          let weight = gaussianWeight(dist, params.splatRadius);
          let densityContrib = i32(weight * FP_SCALE);
          
          let voxelIndex = u32(cellCoord.x) * gridSize.y * gridSize.z +
                           u32(cellCoord.y) * gridSize.z +
                           u32(cellCoord.z);
          
          atomicAdd(&voxels[voxelIndex], densityContrib);
          let colorWeight = weight * COLOR_SCALE;
          atomicAdd(&voxelColorsR[voxelIndex], i32(color.r * colorWeight));
          atomicAdd(&voxelColorsG[voxelIndex], i32(color.g * colorWeight));
          atomicAdd(&voxelColorsB[voxelIndex], i32(color.b * colorWeight));
        }
      }
    }
  }
`;

// 归一化密度场
export const normalizeDensityShader = /* wgsl */`
  @group(0) @binding(0) var<storage, read> voxelsIn: array<i32>;
  @group(0) @binding(1) var<storage, read_write> densityOut: array<f32>;
  @group(0) @binding(2) var<uniform> gridSize: vec3u;
  @group(0) @binding(3) var<storage, read> voxelColorsR: array<i32>;
  @group(0) @binding(4) var<storage, read> voxelColorsG: array<i32>;
  @group(0) @binding(5) var<storage, read> voxelColorsB: array<i32>;
  @group(0) @binding(6) var<storage, read_write> colorsOut: array<vec4f>;
  
  const FP_SCALE: f32 = 10000.0;
  const COLOR_SCALE: f32 = 1000.0;
  
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let gridCount = gridSize.x * gridSize.y * gridSize.z;
    if (id.x >= gridCount) { return; }
    
    let density = f32(voxelsIn[id.x]);
    densityOut[id.x] = density / FP_SCALE;
    
    if (density > 0.0) {
      let totalWeight = density / FP_SCALE * COLOR_SCALE;
      colorsOut[id.x] = vec4f(
        f32(voxelColorsR[id.x]) / totalWeight,
        f32(voxelColorsG[id.x]) / totalWeight,
        f32(voxelColorsB[id.x]) / totalWeight,
        1.0
      );
    } else {
      colorsOut[id.x] = vec4f(0.5, 0.5, 0.5, 1.0);
    }
  }
`;

// Marching Cubes 主计算着色器
export const marchingCubesShader = /* wgsl */`
  struct TriangleVertex {
    position: vec3f,
    _pad0: f32,
    normal: vec3f,
    _pad1: f32,
    color: vec3f,
    _pad2: f32,
  }
  
  struct MCParams {
    isoValue: f32,
    gridSizeX: u32,
    gridSizeY: u32,
    gridSizeZ: u32,
  }
  
  @group(0) @binding(0) var<storage, read> density: array<f32>;
  @group(0) @binding(1) var<storage, read_write> vertices: array<TriangleVertex>;
  @group(0) @binding(2) var<storage, read_write> triangleCount: atomic<u32>;
  @group(0) @binding(3) var<uniform> params: MCParams;
  @group(0) @binding(4) var<storage, read> edgeTable: array<u32>;
  @group(0) @binding(5) var<storage, read> triTable: array<i32>;
  @group(0) @binding(6) var<uniform> gridMin: vec3f;
  @group(0) @binding(7) var<uniform> gridMax: vec3f;
  @group(0) @binding(8) var<storage, read> voxelColors: array<vec4f>;
  
  fn getVoxelIndex(x: u32, y: u32, z: u32) -> u32 {
    return x * params.gridSizeY * params.gridSizeZ + y * params.gridSizeZ + z;
  }
  
  fn getDensity(x: i32, y: i32, z: i32) -> f32 {
    if (x < 0 || x >= i32(params.gridSizeX) ||
        y < 0 || y >= i32(params.gridSizeY) ||
        z < 0 || z >= i32(params.gridSizeZ)) {
      return 0.0;
    }
    return density[getVoxelIndex(u32(x), u32(y), u32(z))];
  }
  
  fn getColor(x: i32, y: i32, z: i32) -> vec3f {
    if (x < 0 || x >= i32(params.gridSizeX) ||
        y < 0 || y >= i32(params.gridSizeY) ||
        z < 0 || z >= i32(params.gridSizeZ)) {
      return vec3f(0.5, 0.5, 0.5);
    }
    return voxelColors[getVoxelIndex(u32(x), u32(y), u32(z))].xyz;
  }
  
  fn interpolateVertex(p1: vec3f, p2: vec3f, v1: f32, v2: f32, iso: f32) -> vec3f {
    if (abs(iso - v1) < 0.00001) { return p1; }
    if (abs(iso - v2) < 0.00001) { return p2; }
    if (abs(v1 - v2) < 0.00001) { return p1; }
    let t = (iso - v1) / (v2 - v1);
    return p1 + t * (p2 - p1);
  }
  
  fn interpolateColor(c1: vec3f, c2: vec3f, v1: f32, v2: f32, iso: f32) -> vec3f {
    if (abs(iso - v1) < 0.00001) { return c1; }
    if (abs(iso - v2) < 0.00001) { return c2; }
    if (abs(v1 - v2) < 0.00001) { return c1; }
    let t = (iso - v1) / (v2 - v1);
    return mix(c1, c2, t);
  }
  
  @compute @workgroup_size(4, 4, 4)
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let x = id.x;
    let y = id.y;
    let z = id.z;
    
    if (x >= params.gridSizeX - 1 || y >= params.gridSizeY - 1 || z >= params.gridSizeZ - 1) {
      return;
    }
    
    let ix = i32(x);
    let iy = i32(y);
    let iz = i32(z);
    
    var cubeValues: array<f32, 8>;
    cubeValues[0] = getDensity(ix,     iy,     iz);
    cubeValues[1] = getDensity(ix + 1, iy,     iz);
    cubeValues[2] = getDensity(ix + 1, iy + 1, iz);
    cubeValues[3] = getDensity(ix,     iy + 1, iz);
    cubeValues[4] = getDensity(ix,     iy,     iz + 1);
    cubeValues[5] = getDensity(ix + 1, iy,     iz + 1);
    cubeValues[6] = getDensity(ix + 1, iy + 1, iz + 1);
    cubeValues[7] = getDensity(ix,     iy + 1, iz + 1);
    
    var cubeColors: array<vec3f, 8>;
    cubeColors[0] = getColor(ix,     iy,     iz);
    cubeColors[1] = getColor(ix + 1, iy,     iz);
    cubeColors[2] = getColor(ix + 1, iy + 1, iz);
    cubeColors[3] = getColor(ix,     iy + 1, iz);
    cubeColors[4] = getColor(ix,     iy,     iz + 1);
    cubeColors[5] = getColor(ix + 1, iy,     iz + 1);
    cubeColors[6] = getColor(ix + 1, iy + 1, iz + 1);
    cubeColors[7] = getColor(ix,     iy + 1, iz + 1);
    
    var cubeIndex: u32 = 0u;
    if (cubeValues[0] > params.isoValue) { cubeIndex |= 1u; }
    if (cubeValues[1] > params.isoValue) { cubeIndex |= 2u; }
    if (cubeValues[2] > params.isoValue) { cubeIndex |= 4u; }
    if (cubeValues[3] > params.isoValue) { cubeIndex |= 8u; }
    if (cubeValues[4] > params.isoValue) { cubeIndex |= 16u; }
    if (cubeValues[5] > params.isoValue) { cubeIndex |= 32u; }
    if (cubeValues[6] > params.isoValue) { cubeIndex |= 64u; }
    if (cubeValues[7] > params.isoValue) { cubeIndex |= 128u; }
    
    if (edgeTable[cubeIndex] == 0u) { return; }
    
    let cellSize = (gridMax - gridMin) / vec3f(f32(params.gridSizeX), f32(params.gridSizeY), f32(params.gridSizeZ));
    let basePos = gridMin + vec3f(f32(x), f32(y), f32(z)) * cellSize;
    
    var cubePos: array<vec3f, 8>;
    cubePos[0] = basePos;
    cubePos[1] = basePos + vec3f(cellSize.x, 0.0, 0.0);
    cubePos[2] = basePos + vec3f(cellSize.x, cellSize.y, 0.0);
    cubePos[3] = basePos + vec3f(0.0, cellSize.y, 0.0);
    cubePos[4] = basePos + vec3f(0.0, 0.0, cellSize.z);
    cubePos[5] = basePos + vec3f(cellSize.x, 0.0, cellSize.z);
    cubePos[6] = basePos + cellSize;
    cubePos[7] = basePos + vec3f(0.0, cellSize.y, cellSize.z);
    
    let defaultColor = vec3f(0.5, 0.5, 0.5);
    var vertList: array<vec3f, 12> = array<vec3f, 12>(
      basePos, basePos, basePos, basePos,
      basePos, basePos, basePos, basePos,
      basePos, basePos, basePos, basePos
    );
    var colorList: array<vec3f, 12> = array<vec3f, 12>(
      defaultColor, defaultColor, defaultColor, defaultColor,
      defaultColor, defaultColor, defaultColor, defaultColor,
      defaultColor, defaultColor, defaultColor, defaultColor
    );
    let edges = edgeTable[cubeIndex];
    
    if ((edges & 1u) != 0u)    { vertList[0]  = interpolateVertex(cubePos[0], cubePos[1], cubeValues[0], cubeValues[1], params.isoValue); colorList[0]  = interpolateColor(cubeColors[0], cubeColors[1], cubeValues[0], cubeValues[1], params.isoValue); }
    if ((edges & 2u) != 0u)    { vertList[1]  = interpolateVertex(cubePos[1], cubePos[2], cubeValues[1], cubeValues[2], params.isoValue); colorList[1]  = interpolateColor(cubeColors[1], cubeColors[2], cubeValues[1], cubeValues[2], params.isoValue); }
    if ((edges & 4u) != 0u)    { vertList[2]  = interpolateVertex(cubePos[2], cubePos[3], cubeValues[2], cubeValues[3], params.isoValue); colorList[2]  = interpolateColor(cubeColors[2], cubeColors[3], cubeValues[2], cubeValues[3], params.isoValue); }
    if ((edges & 8u) != 0u)    { vertList[3]  = interpolateVertex(cubePos[3], cubePos[0], cubeValues[3], cubeValues[0], params.isoValue); colorList[3]  = interpolateColor(cubeColors[3], cubeColors[0], cubeValues[3], cubeValues[0], params.isoValue); }
    if ((edges & 16u) != 0u)   { vertList[4]  = interpolateVertex(cubePos[4], cubePos[5], cubeValues[4], cubeValues[5], params.isoValue); colorList[4]  = interpolateColor(cubeColors[4], cubeColors[5], cubeValues[4], cubeValues[5], params.isoValue); }
    if ((edges & 32u) != 0u)   { vertList[5]  = interpolateVertex(cubePos[5], cubePos[6], cubeValues[5], cubeValues[6], params.isoValue); colorList[5]  = interpolateColor(cubeColors[5], cubeColors[6], cubeValues[5], cubeValues[6], params.isoValue); }
    if ((edges & 64u) != 0u)   { vertList[6]  = interpolateVertex(cubePos[6], cubePos[7], cubeValues[6], cubeValues[7], params.isoValue); colorList[6]  = interpolateColor(cubeColors[6], cubeColors[7], cubeValues[6], cubeValues[7], params.isoValue); }
    if ((edges & 128u) != 0u)  { vertList[7]  = interpolateVertex(cubePos[7], cubePos[4], cubeValues[7], cubeValues[4], params.isoValue); colorList[7]  = interpolateColor(cubeColors[7], cubeColors[4], cubeValues[7], cubeValues[4], params.isoValue); }
    if ((edges & 256u) != 0u)  { vertList[8]  = interpolateVertex(cubePos[0], cubePos[4], cubeValues[0], cubeValues[4], params.isoValue); colorList[8]  = interpolateColor(cubeColors[0], cubeColors[4], cubeValues[0], cubeValues[4], params.isoValue); }
    if ((edges & 512u) != 0u)  { vertList[9]  = interpolateVertex(cubePos[1], cubePos[5], cubeValues[1], cubeValues[5], params.isoValue); colorList[9]  = interpolateColor(cubeColors[1], cubeColors[5], cubeValues[1], cubeValues[5], params.isoValue); }
    if ((edges & 1024u) != 0u) { vertList[10] = interpolateVertex(cubePos[2], cubePos[6], cubeValues[2], cubeValues[6], params.isoValue); colorList[10] = interpolateColor(cubeColors[2], cubeColors[6], cubeValues[2], cubeValues[6], params.isoValue); }
    if ((edges & 2048u) != 0u) { vertList[11] = interpolateVertex(cubePos[3], cubePos[7], cubeValues[3], cubeValues[7], params.isoValue); colorList[11] = interpolateColor(cubeColors[3], cubeColors[7], cubeValues[3], cubeValues[7], params.isoValue); }
    
    let triTableOffset = cubeIndex * 16u;
    for (var i = 0u; i < 16u; i += 3u) {
      let e0 = triTable[triTableOffset + i];
      if (e0 < 0) { break; }
      let e1 = triTable[triTableOffset + i + 1u];
      let e2 = triTable[triTableOffset + i + 2u];
      
      if (e0 > 11 || e1 > 11 || e2 > 11 || e1 < 0 || e2 < 0) { continue; }
      
      let v0 = vertList[u32(e0)];
      let v1 = vertList[u32(e1)];
      let v2 = vertList[u32(e2)];
      let c0 = colorList[u32(e0)];
      let c1 = colorList[u32(e1)];
      let c2 = colorList[u32(e2)];
      
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

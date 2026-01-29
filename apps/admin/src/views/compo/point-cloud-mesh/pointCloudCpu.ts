/* eslint-disable no-plusplus, no-param-reassign */

/**
 * CPU 端点云生成器
 * 用于网格重建时生成点云位置和颜色数据
 */

/** CPU 端生成点云位置数据 */
export function generatePointsCPU(shape: string, count: number, time = 0): Float32Array {
  const positions = new Float32Array(count * 3);
  const TAU = Math.PI * 2;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const r1 = Math.random();
    const r2 = Math.random();
    const r3 = Math.random();

    let x: number;
    let y: number;
    let z: number;

    switch (shape) {
      case 'sphere': {
        const theta = r1 * TAU;
        const phi = Math.acos(2 * r2 - 1);
        const radius = 50 * r3 ** 0.333;
        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.cos(phi);
        z = radius * Math.sin(phi) * Math.sin(theta);
        break;
      }
      case 'cube': {
        x = (r1 - 0.5) * 100;
        y = (r2 - 0.5) * 100;
        z = (r3 - 0.5) * 100;
        break;
      }
      case 'wave': {
        x = (r1 - 0.5) * 100;
        z = (r2 - 0.5) * 100;
        y = Math.sin(x * 0.1 + time) * 10 + Math.cos(z * 0.1 + time * 0.7) * 10;
        y += (r3 - 0.5) * 5;
        break;
      }
      case 'galaxy': {
        const arm = Math.floor(r1 * 4);
        const t = r2;
        const angle = arm * Math.PI * 0.5 + t * Math.PI * 2 + t * t * Math.PI;
        const radius = t * 50 + r3 * 10;
        const height = (Math.random() - 0.5) * 10 * (1 - t);
        x = Math.cos(angle) * radius;
        y = height;
        z = Math.sin(angle) * radius;
        break;
      }
      default:
        x = (r1 - 0.5) * 100;
        y = (r2 - 0.5) * 100;
        z = (r3 - 0.5) * 100;
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
  }

  return positions;
}

/** 根据位置和颜色方案生成颜色数据 */
export function generatePointColors(positions: Float32Array, count: number, colorScheme: number): Float32Array {
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const r = Math.sqrt(x * x + y * y + z * z);

    let cr: number;
    let cg: number;
    let cb: number;

    switch (colorScheme) {
      case 0: // 位置映射
        cr = x / 100 + 0.5;
        cg = y / 100 + 0.5;
        cb = z / 100 + 0.5;
        break;
      case 1: {
        // 深度映射
        const t = r / 60;
        cr = 0.1 + t * 0.3;
        cg = 0.2 + t * 0.5;
        cb = 0.8 - t * 0.3;
        break;
      }
      case 2: {
        // 径向渐变
        const n = r / 50;
        cr = Math.sin(n * Math.PI * 0.5);
        cg = Math.sin(n * Math.PI);
        cb = Math.cos(n * Math.PI * 0.5);
        break;
      }
      case 3: {
        // 彩虹
        const theta = Math.atan2(z, x);
        const hue = (theta + Math.PI) / (2 * Math.PI);
        const h = hue * 6;
        const X = 1 - Math.abs((h % 2) - 1);
        if (h < 1) {
          cr = 1;
          cg = X;
          cb = 0;
        } else if (h < 2) {
          cr = X;
          cg = 1;
          cb = 0;
        } else if (h < 3) {
          cr = 0;
          cg = 1;
          cb = X;
        } else if (h < 4) {
          cr = 0;
          cg = X;
          cb = 1;
        } else if (h < 5) {
          cr = X;
          cg = 0;
          cb = 1;
        } else {
          cr = 1;
          cg = 0;
          cb = X;
        }
        break;
      }
      default:
        cr = 0.5;
        cg = 0.5;
        cb = 0.5;
    }

    colors[i * 3] = Math.max(0, Math.min(1, cr));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, cg));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, cb));
  }

  return colors;
}

/** 生成点云位置和颜色数据 */
export function generatePointCloudData(
  shape: string,
  count: number,
  colorScheme: number,
  time = 0,
): { positions: Float32Array; colors: Float32Array } {
  const positions = generatePointsCPU(shape, count, time);
  const colors = generatePointColors(positions, count, colorScheme);
  return { positions, colors };
}

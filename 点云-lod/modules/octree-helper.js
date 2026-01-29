import * as THREE from "three";

export function createOctreeHelper(scene) {
  let octreeHelper = null;
  let showOctree = false;

  function update(octree) {
    if (octreeHelper) {
      scene.remove(octreeHelper);
      octreeHelper.geometry.dispose();
      octreeHelper.material.dispose();
      octreeHelper = null;
    }

    if (!showOctree || !octree) return;

    // 只显示可见节点的边界框
    const vertices = [];

    for (const node of octree.visibleNodes) {
      const c = node.center;
      const h = node.halfSize;
      const corners = [
        [c.x - h, c.y - h, c.z - h],
        [c.x + h, c.y - h, c.z - h],
        [c.x + h, c.y + h, c.z - h],
        [c.x - h, c.y + h, c.z - h],
        [c.x - h, c.y - h, c.z + h],
        [c.x + h, c.y - h, c.z + h],
        [c.x + h, c.y + h, c.z + h],
        [c.x - h, c.y + h, c.z + h],
      ];

      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];

      for (const [a, b] of edges) {
        vertices.push(...corners[a], ...corners[b]);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.LineBasicMaterial({ 
      color: 0x22c55e, 
      opacity: 0.5, 
      transparent: true 
    });
    octreeHelper = new THREE.LineSegments(geometry, material);
    scene.add(octreeHelper);
  }

  function toggle() {
    showOctree = !showOctree;
    return showOctree;
  }

  return {
    update,
    toggle,
    get isVisible() { return showOctree; }
  };
}

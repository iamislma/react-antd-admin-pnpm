import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export function createThreeContext(canvas) {
  const renderer = new THREE.WebGLRenderer({ 
    canvas, 
    antialias: false, 
    powerPreference: "high-performance" 
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x0a0e13, 1);

  const scene = new THREE.Scene();
  
  const camera = new THREE.PerspectiveCamera(
    60, 
    window.innerWidth / window.innerHeight, 
    0.5, 
    5000
  );
  camera.position.set(0, 0, 600);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  return { renderer, scene, camera, controls };
}

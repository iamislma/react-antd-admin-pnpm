/* eslint-disable no-plusplus, @typescript-eslint/no-explicit-any */
/**
 * 点云网格化组件
 * 使用 WebGPU 和 GPU Marching Cubes 进行点云到网格的转换
 */

import {
  AppstoreOutlined,
  CloudOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, InputNumber, Radio, Select, Slider, Space, Switch, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { MeshReconstructor, type ReconstructResult } from './meshReconstructor';
import { generatePointCloudData } from './pointCloudCpu';
import { COLOR_SCHEMES, type ColorScheme, DEFAULT_CONFIG, getShapeKeys, type ShapeKey, SHAPES } from './shapesConfig';
import { useStyles } from './styles';

const { Text } = Typography;

type ViewMode = 'points' | 'mesh';

interface Stats {
  fps: number;
  pointCount: number;
  triangleCount: number;
  computeTime: number;
  webgpuSupported: boolean;
}

/** 点云网格化组件 */
export default function PointCloudMesh() {
  const { styles } = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointCloudRef = useRef<THREE.Points | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const reconstructorRef = useRef<MeshReconstructor | null>(null);
  const animationRef = useRef<number>(0);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(0);

  // 状态
  const [shape, setShape] = useState<ShapeKey>('sphere');
  const [colorScheme, setColorScheme] = useState<ColorScheme>(0);
  const [pointCount, setPointCount] = useState(DEFAULT_CONFIG.pointCount);
  const [pointSize, setPointSize] = useState(DEFAULT_CONFIG.pointSize);
  const [animSpeed, setAnimSpeed] = useState(DEFAULT_CONFIG.animSpeed);
  const [gridResolution, setGridResolution] = useState(DEFAULT_CONFIG.gridResolution);
  const [isoValue, setIsoValue] = useState(DEFAULT_CONFIG.isoValue);
  const [splatRadius, setSplatRadius] = useState(DEFAULT_CONFIG.splatRadius);
  const [meshOpacity, setMeshOpacity] = useState(DEFAULT_CONFIG.meshOpacity);
  const [viewMode, setViewMode] = useState<ViewMode>('points');
  const [autoRotate, setAutoRotate] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [stats, setStats] = useState<Stats>({
    fps: 0,
    pointCount: 0,
    triangleCount: 0,
    computeTime: 0,
    webgpuSupported: false,
  });

  /** 初始化场景 */
  const initScene = useCallback(() => {
    if (!containerRef.current) return;

    // 场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    sceneRef.current = scene;

    // 相机
    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      2000,
    );
    camera.position.set(100, 80, 120);
    cameraRef.current = camera;

    // 渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 控制器
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.0;
    controlsRef.current = controls;

    // 光照（用于网格）
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 50);
    scene.add(directionalLight);
    const directionalLight2 = new THREE.DirectionalLight(0x8080ff, 0.5);
    directionalLight2.position.set(-50, -50, -50);
    scene.add(directionalLight2);

    // 网格辅助
    const gridHelper = new THREE.GridHelper(200, 20, 0x303050, 0x202030);
    gridHelper.position.y = -60;
    scene.add(gridHelper);
  }, [autoRotate]);

  /** 创建点云 */
  const createPointCloud = useCallback(() => {
    if (!sceneRef.current) return;

    // 移除旧的点云
    if (pointCloudRef.current) {
      sceneRef.current.remove(pointCloudRef.current);
      pointCloudRef.current.geometry.dispose();
      (pointCloudRef.current.material as THREE.Material).dispose();
    }

    const time = clockRef.current.getElapsedTime() * animSpeed;
    const { positions, colors } = generatePointCloudData(shape, pointCount, colorScheme, time);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    sceneRef.current.add(points);
    pointCloudRef.current = points;

    setStats((prev) => ({ ...prev, pointCount }));
  }, [shape, colorScheme, pointCount, pointSize, animSpeed]);

  /** 初始化 WebGPU 网格重建器 */
  const initReconstructor = useCallback(async () => {
    const reconstructor = new MeshReconstructor();
    const success = await reconstructor.init();
    if (success) {
      reconstructorRef.current = reconstructor;
      setStats((prev) => ({ ...prev, webgpuSupported: true }));
    } else {
      setStats((prev) => ({ ...prev, webgpuSupported: false }));
    }
    return success;
  }, []);

  /** 执行网格重建 */
  const reconstructMesh = useCallback(async () => {
    if (!reconstructorRef.current || !sceneRef.current) return;

    const time = clockRef.current.getElapsedTime() * animSpeed;
    const { positions, colors } = generatePointCloudData(shape, pointCount, colorScheme, time);

    reconstructorRef.current.params.isoValue = isoValue;
    reconstructorRef.current.params.splatRadius = splatRadius;
    reconstructorRef.current.setPointCloud(positions, colors, pointCount, gridResolution);

    const result: ReconstructResult | null = await reconstructorRef.current.reconstruct();
    if (!result || result.triangleCount === 0) return;

    // 移除旧的网格
    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
    }

    // 创建新网格
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3));

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: meshOpacity,
      shininess: 30,
    });

    const mesh = new THREE.Mesh(geometry, material);
    sceneRef.current.add(mesh);
    meshRef.current = mesh;

    setStats((prev) => ({
      ...prev,
      triangleCount: result.triangleCount,
      computeTime: reconstructorRef.current?.lastComputeTime || 0,
    }));
  }, [shape, colorScheme, pointCount, gridResolution, isoValue, splatRadius, meshOpacity, animSpeed]);

  /** 更新视图 */
  const updateView = useCallback(() => {
    if (pointCloudRef.current) {
      pointCloudRef.current.visible = viewMode === 'points';
    }
    if (meshRef.current) {
      meshRef.current.visible = viewMode === 'mesh';
    }
  }, [viewMode]);

  /** 动画循环 */
  const animate = useCallback(() => {
    animationRef.current = requestAnimationFrame(animate);

    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    // 更新控制器
    if (controlsRef.current) {
      controlsRef.current.update();
    }

    // 更新点云动画
    if (isPlaying && viewMode === 'points' && pointCloudRef.current) {
      const time = clockRef.current.getElapsedTime() * animSpeed;
      const { positions, colors } = generatePointCloudData(shape, pointCount, colorScheme, time);

      const positionAttr = pointCloudRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const colorAttr = pointCloudRef.current.geometry.attributes.color as THREE.BufferAttribute;

      positionAttr.array.set(positions);
      positionAttr.needsUpdate = true;
      colorAttr.array.set(colors);
      colorAttr.needsUpdate = true;
    }

    // 渲染
    rendererRef.current.render(sceneRef.current, cameraRef.current);

    // 计算 FPS
    frameCountRef.current++;
    const currentTime = performance.now();
    if (currentTime - lastFpsTimeRef.current >= 1000) {
      setStats((prev) => ({ ...prev, fps: frameCountRef.current }));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = currentTime;
    }
  }, [isPlaying, viewMode, shape, colorScheme, pointCount, animSpeed]);

  /** 重建网格按钮点击 */
  const handleReconstructClick = useCallback(async () => {
    await reconstructMesh();
    setViewMode('mesh');
  }, [reconstructMesh]);

  /** 重置相机 */
  const handleResetCamera = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(100, 80, 120);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, []);

  // 初始化
  useEffect(() => {
    initScene();
    initReconstructor();

    return () => {
      cancelAnimationFrame(animationRef.current);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      if (reconstructorRef.current) {
        reconstructorRef.current.destroy();
      }
    };
  }, [initScene, initReconstructor]);

  // 创建初始点云
  useEffect(() => {
    createPointCloud();
  }, [createPointCloud]);

  // 启动动画
  useEffect(() => {
    animate();
    return () => cancelAnimationFrame(animationRef.current);
  }, [animate]);

  // 更新视图
  useEffect(() => {
    updateView();
  }, [updateView]);

  // 更新自动旋转
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // 更新点大小
  useEffect(() => {
    if (pointCloudRef.current) {
      (pointCloudRef.current.material as THREE.PointsMaterial).size = pointSize;
    }
  }, [pointSize]);

  // 更新网格透明度
  useEffect(() => {
    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshPhongMaterial).opacity = meshOpacity;
    }
  }, [meshOpacity]);

  // 窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={styles.container}>
      {/* 3D 视图 */}
      <div ref={containerRef} className={styles.canvasContainer}>
        {/* 状态面板 */}
        <div className={styles.statsPanel}>
          <div>FPS: {stats.fps}</div>
          <div>点数: {stats.pointCount.toLocaleString()}</div>
          {viewMode === 'mesh' && (
            <>
              <div>三角形: {stats.triangleCount.toLocaleString()}</div>
              <div>计算时间: {stats.computeTime.toFixed(1)}ms</div>
            </>
          )}
          <div style={{ marginTop: 4 }}>
            <span className={`${styles.webgpuBadge} ${stats.webgpuSupported ? 'supported' : 'unsupported'}`}>
              WebGPU: {stats.webgpuSupported ? '✓ 支持' : '✗ 不支持'}
            </span>
          </div>
        </div>
      </div>

      {/* 控制面板 */}
      <div className={styles.controlPanel}>
        {/* 视图模式 */}
        <div>
          <div className={styles.sectionTitle}>视图模式</div>
          <div className={styles.viewToggle}>
            <Button
              type={viewMode === 'points' ? 'primary' : 'default'}
              icon={<CloudOutlined />}
              onClick={() => setViewMode('points')}
            >
              点云
            </Button>
            <Button
              type={viewMode === 'mesh' ? 'primary' : 'default'}
              icon={<AppstoreOutlined />}
              onClick={() => setViewMode('mesh')}
              disabled={!stats.webgpuSupported}
            >
              网格
            </Button>
          </div>
        </div>

        <div className={styles.divider} />

        {/* 形态选择 */}
        <div>
          <div className={styles.sectionTitle}>形态</div>
          <Select
            value={shape}
            onChange={setShape}
            style={{ width: '100%' }}
            options={getShapeKeys().map((key) => ({
              value: key,
              label: SHAPES[key].name,
            }))}
          />
        </div>

        {/* 颜色方案 */}
        <div>
          <div className={styles.sectionTitle}>颜色方案</div>
          <Radio.Group value={colorScheme} onChange={(e) => setColorScheme(e.target.value)} size='small'>
            {COLOR_SCHEMES.map((scheme, index) => (
              <Radio.Button key={scheme.name} value={index}>
                {scheme.name}
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>

        <div className={styles.divider} />

        {/* 点云参数 */}
        <div>
          <div className={styles.sectionTitle}>点云参数</div>

          <Text type='secondary'>点数量</Text>
          <div className={styles.sliderRow}>
            <Slider min={1000} max={500000} step={1000} value={pointCount} onChange={setPointCount} />
            <InputNumber
              min={1000}
              max={500000}
              step={1000}
              value={pointCount}
              onChange={(v) => v && setPointCount(v)}
            />
          </div>

          <Text type='secondary'>点大小</Text>
          <div className={styles.sliderRow}>
            <Slider min={0.5} max={5} step={0.1} value={pointSize} onChange={setPointSize} />
            <InputNumber min={0.5} max={5} step={0.1} value={pointSize} onChange={(v) => v && setPointSize(v)} />
          </div>

          <Text type='secondary'>动画速度</Text>
          <div className={styles.sliderRow}>
            <Slider min={0} max={2} step={0.1} value={animSpeed} onChange={setAnimSpeed} />
            <InputNumber min={0} max={2} step={0.1} value={animSpeed} onChange={(v) => v !== null && setAnimSpeed(v)} />
          </div>
        </div>

        <div className={styles.divider} />

        {/* 网格重建参数 */}
        <div>
          <div className={styles.sectionTitle}>网格重建参数</div>

          <Text type='secondary'>网格分辨率</Text>
          <div className={styles.sliderRow}>
            <Slider
              min={32}
              max={128}
              step={8}
              value={gridResolution}
              onChange={setGridResolution}
              disabled={!stats.webgpuSupported}
            />
            <InputNumber
              min={32}
              max={128}
              step={8}
              value={gridResolution}
              onChange={(v) => v && setGridResolution(v)}
              disabled={!stats.webgpuSupported}
            />
          </div>

          <Text type='secondary'>等值面阈值 (Iso Value)</Text>
          <div className={styles.sliderRow}>
            <Slider
              min={0.1}
              max={0.9}
              step={0.05}
              value={isoValue}
              onChange={setIsoValue}
              disabled={!stats.webgpuSupported}
            />
            <InputNumber
              min={0.1}
              max={0.9}
              step={0.05}
              value={isoValue}
              onChange={(v) => v && setIsoValue(v)}
              disabled={!stats.webgpuSupported}
            />
          </div>

          <Text type='secondary'>Splat 半径</Text>
          <div className={styles.sliderRow}>
            <Slider
              min={0.5}
              max={5}
              step={0.1}
              value={splatRadius}
              onChange={setSplatRadius}
              disabled={!stats.webgpuSupported}
            />
            <InputNumber
              min={0.5}
              max={5}
              step={0.1}
              value={splatRadius}
              onChange={(v) => v && setSplatRadius(v)}
              disabled={!stats.webgpuSupported}
            />
          </div>

          <Text type='secondary'>网格透明度</Text>
          <div className={styles.sliderRow}>
            <Slider min={0.1} max={1} step={0.1} value={meshOpacity} onChange={setMeshOpacity} />
            <InputNumber min={0.1} max={1} step={0.1} value={meshOpacity} onChange={(v) => v && setMeshOpacity(v)} />
          </div>

          <Tooltip title={!stats.webgpuSupported ? '需要 WebGPU 支持' : ''}>
            <Button
              type='primary'
              block
              onClick={handleReconstructClick}
              disabled={!stats.webgpuSupported}
              style={{ marginTop: 8 }}
            >
              执行网格重建
            </Button>
          </Tooltip>
        </div>

        <div className={styles.divider} />

        {/* 控制按钮 */}
        <div>
          <div className={styles.sectionTitle}>控制</div>
          <Space direction='vertical' style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text>自动旋转</Text>
              <Switch checked={autoRotate} onChange={setAutoRotate} />
            </div>
            <div className={styles.buttonGroup}>
              <Button
                icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? '暂停' : '播放'}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleResetCamera}>
                重置视角
              </Button>
            </div>
          </Space>
        </div>
      </div>
    </div>
  );
}

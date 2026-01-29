/* eslint-disable no-plusplus, no-console, @typescript-eslint/no-explicit-any */
/**
 * 点云网格化-碰撞组件
 * FBM+Perlin 地形点云渲染 + WebGPU Marching Cubes 网格重建 + Rapier3D 物理碰撞
 */

import { ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Divider, InputNumber, Radio, Slider, Space, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
// @ts-expect-error - Three.js webgpu build direct import
import { WebGPURenderer } from 'three/build/three.webgpu.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 复用点云网格化模块的 WebGPU 网格重建器
import { MeshReconstructor, type ReconstructResult } from '../point-cloud-mesh/meshReconstructor';
import { ChunkedTerrainCollider } from './chunkedTerrainCollider';
import { generateTerrainColors, generateTerrainPointsCPU } from './cpuNoise';
import { PhysicsBall } from './physicsBall';
import { useStyles } from './styles';
import { COLOR_SCHEMES, type ColorScheme, DEFAULT_CONFIG } from './terrainConfig';

const { Text, Title } = Typography;

/** 统计信息 */
interface Stats {
  fps: number;
  pointCount: number;
  triangleCount: number;
  computeTime: number;
  physicsStatus: string;
  activeChunks: number;
  ballPosition: { x: number; y: number; z: number } | null;
}

/** 点云网格化-碰撞组件 */
export default function PointCloudMeshCollision() {
  const { styles } = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGPURenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const reconstructorRef = useRef<MeshReconstructor | null>(null);
  const animationRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(0);

  // 物理引擎
  const rapierRef = useRef<any>(null);
  const physicsWorldRef = useRef<any>(null);
  const physicsBallRef = useRef<PhysicsBall | null>(null);
  const chunkedTerrainRef = useRef<ChunkedTerrainCollider | null>(null);

  // 状态
  const [colorScheme, setColorScheme] = useState<ColorScheme>(DEFAULT_CONFIG.colorScheme);
  const [pointCount, setPointCount] = useState(DEFAULT_CONFIG.pointCount);
  const [gridResolution, setGridResolution] = useState(DEFAULT_CONFIG.gridResolution);
  const [isoValue, setIsoValue] = useState(DEFAULT_CONFIG.isoValue);
  const [splatRadius, setSplatRadius] = useState(DEFAULT_CONFIG.splatRadius);
  const [meshOpacity, setMeshOpacity] = useState(DEFAULT_CONFIG.meshOpacity);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // 球体物理参数
  const [ballForce, setBallForce] = useState(DEFAULT_CONFIG.ball.force);
  const [ballJumpForce, setBallJumpForce] = useState(DEFAULT_CONFIG.ball.jumpForce);
  const [ballDamping, setBallDamping] = useState(DEFAULT_CONFIG.ball.damping);
  const [ballFriction, setBallFriction] = useState(DEFAULT_CONFIG.ball.friction);
  const [ballRestitution, setBallRestitution] = useState(DEFAULT_CONFIG.ball.restitution);

  // 统计信息
  const [stats, setStats] = useState<Stats>({
    fps: 0,
    pointCount: 0,
    triangleCount: 0,
    computeTime: 0,
    physicsStatus: '初始化中...',
    activeChunks: 0,
    ballPosition: null,
  });

  /** 初始化物理引擎 */
  const initPhysics = useCallback(async () => {
    try {
      const RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();

      rapierRef.current = RAPIER;
      const gravity = { x: 0.0, y: -30.0, z: 0.0 };
      physicsWorldRef.current = new RAPIER.World(gravity);

      setStats((prev) => ({ ...prev, physicsStatus: '运行中' }));
      console.log('Rapier physics initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize physics:', error);
      setStats((prev) => ({ ...prev, physicsStatus: '初始化失败' }));
      return false;
    }
  }, []);

  /** 创建物理球 */
  const createBall = useCallback(() => {
    if (!physicsWorldRef.current || !sceneRef.current || !rapierRef.current) return;

    if (physicsBallRef.current) {
      physicsBallRef.current.destroy();
    }

    physicsBallRef.current = new PhysicsBall(physicsWorldRef.current, rapierRef.current, sceneRef.current, {
      radius: 2.5,
      startHeight: 100,
      force: ballForce,
      jumpForce: ballJumpForce,
      damping: ballDamping,
      friction: ballFriction,
      restitution: ballRestitution,
    });

    physicsBallRef.current.create();
    console.log('Ball created at height 100');
  }, [ballForce, ballJumpForce, ballDamping, ballFriction, ballRestitution]);

  /** 构建地形碰撞 */
  const buildTerrainCollision = useCallback((meshPositions: Float32Array) => {
    if (!physicsWorldRef.current || !rapierRef.current) return;

    if (chunkedTerrainRef.current) {
      chunkedTerrainRef.current.destroy();
    }

    chunkedTerrainRef.current = new ChunkedTerrainCollider(physicsWorldRef.current, rapierRef.current, 10, 10);
    chunkedTerrainRef.current.buildFromMesh(meshPositions);

    // 立即激活球体附近的块
    if (physicsBallRef.current) {
      const pos = physicsBallRef.current.getPosition();
      if (pos) {
        chunkedTerrainRef.current.updateActiveChunks(pos.x, pos.z);
      }
    }

    console.log('Terrain collision built with chunking');
  }, []);

  /** 网格重建 */
  const rebuildMesh = useCallback(async () => {
    if (!reconstructorRef.current || !sceneRef.current) {
      console.warn('rebuildMesh: reconstructor or scene not ready');
      return;
    }

    console.log('Starting mesh reconstruction with', pointCount, 'points');
    setIsRebuilding(true);

    try {
      // 生成地形点云数据
      const positions = generateTerrainPointsCPU(pointCount);
      const colors = generateTerrainColors(positions, colorScheme);

      // 设置参数
      reconstructorRef.current.params.isoValue = isoValue;
      reconstructorRef.current.params.splatRadius = splatRadius;

      // 准备点云数据
      reconstructorRef.current.setPointCloud(positions, colors, pointCount, gridResolution);

      // 执行重建
      const result: ReconstructResult | null = await reconstructorRef.current.reconstruct();

      if (!result || result.triangleCount === 0) {
        setStats((prev) => ({ ...prev, triangleCount: 0, computeTime: 0 }));
        setIsRebuilding(false);
        return;
      }

      setStats((prev) => ({
        ...prev,
        pointCount,
        triangleCount: result.triangleCount,
        computeTime: reconstructorRef.current?.lastComputeTime ?? 0,
      }));

      // 移除旧网格
      if (meshRef.current) {
        sceneRef.current.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        if (meshRef.current.material instanceof THREE.Material) {
          meshRef.current.material.dispose();
        }
      }

      // 创建新网格
      const meshGeometry = new THREE.BufferGeometry();
      meshGeometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
      meshGeometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
      meshGeometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3));

      const meshMaterial = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        transparent: true,
        opacity: meshOpacity,
        metalness: 0.1,
        roughness: 0.6,
        side: THREE.DoubleSide,
      });

      meshRef.current = new THREE.Mesh(meshGeometry, meshMaterial);
      meshRef.current.receiveShadow = true;
      sceneRef.current.add(meshRef.current);

      // 构建物理碰撞
      buildTerrainCollision(result.positions);
    } catch (error) {
      console.error('Mesh reconstruction error:', error);
    }

    setIsRebuilding(false);
  }, [pointCount, colorScheme, gridResolution, isoValue, splatRadius, meshOpacity, buildTerrainCollision]);

  /** 重置球体 */
  const resetBall = useCallback(() => {
    if (physicsBallRef.current) {
      physicsBallRef.current.reset();
    }
  }, []);

  /** 初始化场景 */
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const initScene = async () => {
      // 检测 WebGPU 支持
      if (!navigator.gpu) {
        console.error('WebGPU is not supported');
        return;
      }

      // 创建 WebGPU 渲染器
      const renderer = new WebGPURenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });

      await renderer.init();

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setClearColor(0x0a0d12, 1);
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // 场景
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      // 相机
      const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 2000);
      camera.position.set(0, 80, 150);
      cameraRef.current = camera;

      // 灯光
      const ambientLight = new THREE.AmbientLight(0x404050, 0.5);
      scene.add(ambientLight);

      const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
      directionalLight1.position.set(100, 100, 100);
      scene.add(directionalLight1);

      const directionalLight2 = new THREE.DirectionalLight(0x6080ff, 0.5);
      directionalLight2.position.set(-100, -50, -100);
      scene.add(directionalLight2);

      // 控制器
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = false;
      controlsRef.current = controls;

      // 初始化网格重建器
      const reconstructor = new MeshReconstructor();
      const meshSuccess = await reconstructor.init();
      if (meshSuccess) {
        reconstructorRef.current = reconstructor;
        console.log('MeshReconstructor ready');
      } else {
        console.error('MeshReconstructor init failed');
      }

      // 初始化物理引擎
      await initPhysics();

      setIsInitialized(true);
      console.log('Scene initialization complete, isInitialized set to true');
    };

    initScene();

    // eslint-disable-next-line consistent-return
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (physicsBallRef.current) {
        physicsBallRef.current.destroy();
      }
      if (chunkedTerrainRef.current) {
        chunkedTerrainRef.current.destroy();
      }
      if (reconstructorRef.current) {
        reconstructorRef.current.destroy();
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        container.removeChild(rendererRef.current.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 初始化完成后，创建球和网格 */
  useEffect(() => {
    if (isInitialized && physicsWorldRef.current && reconstructorRef.current && !meshRef.current) {
      console.log('Creating ball and mesh...');
      // 只在首次初始化时执行
      createBall();
      rebuildMesh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized]);

  /** 渲染循环 */
  useEffect(() => {
    if (!isInitialized) return;

    let lastStatsUpdate = 0;

    const render = () => {
      animationRef.current = requestAnimationFrame(render);

      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

      const now = performance.now();

      // FPS 计算
      frameCountRef.current++;
      if (now - lastFpsTimeRef.current >= 1000) {
        setStats((prev) => ({ ...prev, fps: frameCountRef.current }));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // 物理步进
      if (physicsWorldRef.current) {
        if (physicsBallRef.current) {
          physicsBallRef.current.applyForces();
        }

        physicsWorldRef.current.step();

        if (physicsBallRef.current) {
          physicsBallRef.current.syncPosition();
          physicsBallRef.current.checkBounds();

          const pos = physicsBallRef.current.getPosition();
          if (pos && chunkedTerrainRef.current) {
            const activeCount = chunkedTerrainRef.current.updateActiveChunks(pos.x, pos.z);
            if (now - lastStatsUpdate >= 100) {
              setStats((prev) => ({
                ...prev,
                activeChunks: activeCount,
                ballPosition: pos,
              }));
              lastStatsUpdate = now;
            }
          }
        }
      }

      controlsRef.current?.update();
      rendererRef.current.renderAsync(sceneRef.current, cameraRef.current);
    };

    render();

    // eslint-disable-next-line consistent-return
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isInitialized]);

  /** 窗口大小调整 */
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(clientWidth, clientHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /** 更新球体物理参数 */
  useEffect(() => {
    if (physicsBallRef.current) {
      physicsBallRef.current.params.force = ballForce;
      physicsBallRef.current.params.jumpForce = ballJumpForce;
      physicsBallRef.current.setDamping(ballDamping);
      physicsBallRef.current.setFriction(ballFriction);
      physicsBallRef.current.setRestitution(ballRestitution);
    }
  }, [ballForce, ballJumpForce, ballDamping, ballFriction, ballRestitution]);

  /** 更新网格透明度 */
  useEffect(() => {
    if (meshRef.current && meshRef.current.material instanceof THREE.MeshPhysicalMaterial) {
      meshRef.current.material.opacity = meshOpacity;
    }
  }, [meshOpacity]);

  // FPS 样式
  const getFpsClass = () => {
    if (stats.fps >= 50) return styles.fpsGood;
    if (stats.fps >= 30) return styles.fpsMid;
    return styles.fpsBad;
  };
  const fpsClass = getFpsClass();

  return (
    <div className={styles.container} ref={containerRef}>
      {/* 控制面板 */}
      <div className={styles.controlPanel}>
        <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
          🏔️ 地形物理模拟
        </Title>

        <div className={styles.sectionTitle}>颜色方案</div>
        <Radio.Group value={colorScheme} onChange={(e) => setColorScheme(e.target.value)} size='small'>
          {COLOR_SCHEMES.map((scheme) => (
            <Radio.Button key={scheme.value} value={scheme.value}>
              {scheme.name}
            </Radio.Button>
          ))}
        </Radio.Group>

        <Divider style={{ margin: '12px 0' }} />

        <div className={styles.sectionTitle}>网格重建参数</div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            点数量
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={100000} max={2000000} step={100000} value={pointCount} onChange={setPointCount} />
          </div>
          <InputNumber
            className={styles.inputNumber}
            min={100000}
            max={2000000}
            step={100000}
            value={pointCount}
            onChange={(v) => v && setPointCount(v)}
          />
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            网格分辨率
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={32} max={256} step={16} value={gridResolution} onChange={setGridResolution} />
          </div>
          <InputNumber
            className={styles.inputNumber}
            min={32}
            max={256}
            step={16}
            value={gridResolution}
            onChange={(v) => v && setGridResolution(v)}
          />
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            等值面阈值
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={0.1} max={5.0} step={0.1} value={isoValue} onChange={setIsoValue} />
          </div>
          <InputNumber
            className={styles.inputNumber}
            min={0.1}
            max={5.0}
            step={0.1}
            value={isoValue}
            onChange={(v) => v && setIsoValue(v)}
          />
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            Splat 半径
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={0.5} max={10.0} step={0.5} value={splatRadius} onChange={setSplatRadius} />
          </div>
          <InputNumber
            className={styles.inputNumber}
            min={0.5}
            max={10.0}
            step={0.5}
            value={splatRadius}
            onChange={(v) => v && setSplatRadius(v)}
          />
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            网格透明度
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={0.1} max={1} step={0.1} value={meshOpacity} onChange={setMeshOpacity} />
          </div>
        </div>

        <Button type='primary' icon={<ReloadOutlined />} loading={isRebuilding} onClick={rebuildMesh} block>
          重建网格
        </Button>

        <Divider style={{ margin: '12px 0' }} />

        <div className={styles.sectionTitle}>球体物理参数</div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            推力
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={100} max={1000} step={50} value={ballForce} onChange={setBallForce} />
          </div>
          <InputNumber
            className={styles.inputNumber}
            min={100}
            max={1000}
            step={50}
            value={ballForce}
            onChange={(v) => v && setBallForce(v)}
          />
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            跳跃力
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={100} max={500} step={25} value={ballJumpForce} onChange={setBallJumpForce} />
          </div>
          <InputNumber
            className={styles.inputNumber}
            min={100}
            max={500}
            step={25}
            value={ballJumpForce}
            onChange={(v) => v && setBallJumpForce(v)}
          />
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            阻尼
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={0} max={1} step={0.1} value={ballDamping} onChange={setBallDamping} />
          </div>
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            摩擦力
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={0} max={1} step={0.1} value={ballFriction} onChange={setBallFriction} />
          </div>
        </div>

        <div className={styles.row}>
          <Text type='secondary' style={{ width: 80 }}>
            弹性
          </Text>
          <div className={styles.sliderContainer}>
            <Slider min={0} max={1} step={0.1} value={ballRestitution} onChange={setBallRestitution} />
          </div>
        </div>

        <Button icon={<RocketOutlined />} onClick={resetBall} block>
          重置球体位置
        </Button>
      </div>

      {/* 统计面板 */}
      <div className={styles.statsPanel}>
        <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
          📊 统计信息
        </Title>
        <div className={styles.statsRow}>
          <span className={styles.statsLabel}>FPS</span>
          <span className={fpsClass}>{stats.fps}</span>
        </div>
        <div className={styles.statsRow}>
          <span className={styles.statsLabel}>点数量</span>
          <span className={styles.statsValue}>{stats.pointCount.toLocaleString()}</span>
        </div>
        <div className={styles.statsRow}>
          <span className={styles.statsLabel}>三角形数</span>
          <span className={styles.statsValue}>{stats.triangleCount.toLocaleString()}</span>
        </div>
        <div className={styles.statsRow}>
          <span className={styles.statsLabel}>重建耗时</span>
          <span className={styles.statsValue}>{stats.computeTime.toFixed(1)} ms</span>
        </div>
        <div className={styles.statsRow}>
          <span className={styles.statsLabel}>物理引擎</span>
          <span className={styles.statsValue}>{stats.physicsStatus}</span>
        </div>
        <div className={styles.statsRow}>
          <span className={styles.statsLabel}>活跃碰撞块</span>
          <span className={styles.statsValue}>{stats.activeChunks}</span>
        </div>
        {stats.ballPosition && (
          <div className={styles.statsRow}>
            <span className={styles.statsLabel}>球体位置</span>
            <span className={styles.statsValue}>
              ({stats.ballPosition.x.toFixed(1)}, {stats.ballPosition.y.toFixed(1)}, {stats.ballPosition.z.toFixed(1)})
            </span>
          </div>
        )}
      </div>

      {/* 控制提示 */}
      <div className={styles.hint}>
        <Space>
          <span>🎮 WASD 移动</span>
          <span>|</span>
          <span>空格 跳跃</span>
          <span>|</span>
          <span>鼠标 旋转视角</span>
        </Space>
      </div>
    </div>
  );
}

/* eslint-disable no-console */
/**
 * 物理球体管理模块
 * 处理球体刚体创建、键盘控制和物理同步
 */

import * as THREE from 'three';

import type RAPIER from '@dimforge/rapier3d-compat';
import type { KeysPressed } from './terrainConfig';

/** 球体配置参数 */
export interface BallConfig {
  radius: number;
  startHeight: number;
  force: number;
  jumpForce: number;
  damping: number;
  airControl: number;
  friction: number;
  restitution: number;
}

/** 球体位置 */
export interface BallPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * PhysicsBall 类
 * 管理物理球体的创建、控制和渲染同步
 */
export class PhysicsBall {
  private world: RAPIER.World;

  private RAPIER: typeof RAPIER;

  private scene: THREE.Scene;

  // 球体参数
  public params: BallConfig;

  // 物理组件
  private rigidBody: RAPIER.RigidBody | null = null;

  private collider: RAPIER.Collider | null = null;

  private mesh: THREE.Mesh | null = null;

  // 键盘状态
  public keysPressed: KeysPressed = { w: false, a: false, s: false, d: false, space: false };

  // 事件监听器引用
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * 创建物理球体管理器
   */
  constructor(world: RAPIER.World, rapier: typeof RAPIER, scene: THREE.Scene, config: Partial<BallConfig> = {}) {
    this.world = world;
    this.RAPIER = rapier;
    this.scene = scene;

    this.params = {
      radius: config.radius ?? 2.0,
      startHeight: config.startHeight ?? 50,
      force: config.force ?? 400,
      jumpForce: config.jumpForce ?? 250,
      damping: config.damping ?? 0.3,
      airControl: config.airControl ?? 0.6,
      friction: config.friction ?? 0.5,
      restitution: config.restitution ?? 0.4,
    };

    this.setupKeyboardControls();
  }

  /**
   * 创建物理球体和渲染球体
   */
  create(): void {
    if (!this.world || !this.scene) return;

    // 移除旧球体
    this.destroyBall();

    // 创建刚体 (动态)
    const rigidBodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, this.params.startHeight, 0)
      .setLinearDamping(this.params.damping)
      .setAngularDamping(0.2)
      .setCcdEnabled(true);

    this.rigidBody = this.world.createRigidBody(rigidBodyDesc);

    // 创建球形碰撞体
    const colliderDesc = this.RAPIER.ColliderDesc.ball(this.params.radius)
      .setFriction(this.params.friction)
      .setRestitution(this.params.restitution)
      .setDensity(0.8);

    this.collider = this.world.createCollider(colliderDesc, this.rigidBody);

    // 创建 Three.js 球体
    const ballGeometry = new THREE.SphereGeometry(this.params.radius, 32, 32);
    const ballMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xff6b6b,
      metalness: 0.3,
      roughness: 0.4,
      emissive: 0x331111,
      emissiveIntensity: 0.2,
    });

    this.mesh = new THREE.Mesh(ballGeometry, ballMaterial);
    this.mesh.position.set(0, this.params.startHeight, 0);
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);

    console.log('Ball created at height', this.params.startHeight);
  }

  /**
   * 销毁球体
   */
  private destroyBall(): void {
    if (this.rigidBody) {
      this.world.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.mesh.material instanceof THREE.Material) {
        this.mesh.material.dispose();
      }
      this.mesh = null;
    }
  }

  /**
   * 设置键盘控制监听
   */
  private setupKeyboardControls(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') this.keysPressed.w = true;
      if (key === 'a') this.keysPressed.a = true;
      if (key === 's') this.keysPressed.s = true;
      if (key === 'd') this.keysPressed.d = true;
      if (key === ' ') this.keysPressed.space = true;
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') this.keysPressed.w = false;
      if (key === 'a') this.keysPressed.a = false;
      if (key === 's') this.keysPressed.s = false;
      if (key === 'd') this.keysPressed.d = false;
      if (key === ' ') this.keysPressed.space = false;
    };

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
  }

  /**
   * 根据键盘输入对球体施加力
   */
  applyForces(): void {
    if (!this.rigidBody) return;

    // 唤醒刚体
    this.rigidBody.wakeUp();

    const vel = this.rigidBody.linvel();
    const isGrounded = Math.abs(vel.y) < 3;
    const controlMultiplier = isGrounded ? 1.0 : this.params.airControl;

    // 计算力的方向
    let forceX = 0;
    let forceZ = 0;

    if (this.keysPressed.w) forceZ -= this.params.force;
    if (this.keysPressed.s) forceZ += this.params.force;
    if (this.keysPressed.a) forceX -= this.params.force;
    if (this.keysPressed.d) forceX += this.params.force;

    // 施加力
    if (forceX !== 0 || forceZ !== 0) {
      const impulse = {
        x: forceX * 0.016 * controlMultiplier,
        y: 0,
        z: forceZ * 0.016 * controlMultiplier,
      };
      this.rigidBody.applyImpulse(impulse, true);
    }

    // 空格键跳跃
    if (this.keysPressed.space) {
      if (Math.abs(vel.y) < 8) {
        this.rigidBody.applyImpulse({ x: 0, y: this.params.jumpForce, z: 0 }, true);
      }
      this.keysPressed.space = false;
    }
  }

  /**
   * 同步物理位置到 Three.js 网格
   */
  syncPosition(): BallPosition | null {
    if (!this.rigidBody || !this.mesh) return null;

    const pos = this.rigidBody.translation();
    const rot = this.rigidBody.rotation();

    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    return { x: pos.x, y: pos.y, z: pos.z };
  }

  /**
   * 重置球体位置
   */
  reset(): void {
    if (this.rigidBody) {
      this.rigidBody.setTranslation({ x: 0, y: this.params.startHeight, z: 0 }, true);
      this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /**
   * 检查并重置掉出边界的球体
   */
  checkBounds(): void {
    if (!this.rigidBody) return;
    const pos = this.rigidBody.translation();
    if (pos.y < -100) {
      this.reset();
    }
  }

  /**
   * 获取当前位置
   */
  getPosition(): BallPosition | null {
    if (!this.rigidBody) return null;
    const pos = this.rigidBody.translation();
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  /**
   * 更新阻尼参数
   */
  setDamping(value: number): void {
    this.params.damping = value;
    if (this.rigidBody) {
      this.rigidBody.setLinearDamping(value);
    }
  }

  /**
   * 更新摩擦力参数
   */
  setFriction(value: number): void {
    this.params.friction = value;
    if (this.collider) {
      this.collider.setFriction(value);
    }
  }

  /**
   * 更新弹性参数
   */
  setRestitution(value: number): void {
    this.params.restitution = value;
    if (this.collider) {
      this.collider.setRestitution(value);
    }
  }

  /**
   * 完全销毁，包括移除事件监听
   */
  destroy(): void {
    this.destroyBall();
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler);
    }
  }
}

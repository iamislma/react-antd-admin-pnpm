/**
 * 物理球体管理模块
 * 处理球体刚体创建、键盘控制和物理同步
 */

import * as THREE from 'three';

/**
 * PhysicsBall 类
 * 管理物理球体的创建、控制和渲染同步
 */
export class PhysicsBall {
  /**
   * 创建物理球体管理器
   * @param {Object} world - Rapier 物理世界
   * @param {Object} RAPIER - Rapier 模块引用
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {Object} config - 可选配置参数
   */
  constructor(world, RAPIER, scene, config = {}) {
    this.world = world;
    this.RAPIER = RAPIER;
    this.scene = scene;

    // 球体参数 (可通过 config 覆盖)
    this.params = {
      radius: config.radius ?? 2.0,
      startHeight: config.startHeight ?? 50,
      force: config.force ?? 400,           // WASD 推力
      jumpForce: config.jumpForce ?? 250,   // 跳跃力
      damping: config.damping ?? 0.3,       // 线性阻尼
      airControl: config.airControl ?? 0.6, // 空中控制系数
      friction: config.friction ?? 0.5,     // 摩擦力
      restitution: config.restitution ?? 0.4 // 弹性
    };

    // 物理组件
    this.rigidBody = null;
    this.collider = null;
    this.mesh = null;

    // 键盘状态
    this.keysPressed = { w: false, a: false, s: false, d: false, space: false };

    // 自动设置键盘控制
    this.setupKeyboardControls();
  }

  /**
   * 创建物理球体和渲染球体
   */
  create() {
    if (!this.world || !this.scene) return;

    // 移除旧球体
    this.destroy();

    // 创建刚体 (动态)
    const rigidBodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, this.params.startHeight, 0)
      .setLinearDamping(this.params.damping)
      .setAngularDamping(0.2)  // 降低角阻尼，滚动更顺畅
      .setCcdEnabled(true);  // 启用连续碰撞检测，防止高速穿透

    this.rigidBody = this.world.createRigidBody(rigidBodyDesc);

    // 创建球形碰撞体
    const colliderDesc = this.RAPIER.ColliderDesc.ball(this.params.radius)
      .setFriction(this.params.friction)
      .setRestitution(this.params.restitution)
      .setDensity(0.8);  // 降低密度，更轻更灵活

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

    console.log("Ball created at height", this.params.startHeight);
  }

  /**
   * 销毁球体
   */
  destroy() {
    if (this.rigidBody) {
      this.world.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.collider = null;
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }

  /**
   * 设置键盘控制监听
   */
  setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'w') this.keysPressed.w = true;
      if (key === 'a') this.keysPressed.a = true;
      if (key === 's') this.keysPressed.s = true;
      if (key === 'd') this.keysPressed.d = true;
      if (key === ' ') this.keysPressed.space = true;
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'w') this.keysPressed.w = false;
      if (key === 'a') this.keysPressed.a = false;
      if (key === 's') this.keysPressed.s = false;
      if (key === 'd') this.keysPressed.d = false;
      if (key === ' ') this.keysPressed.space = false;
    });
  }

  /**
   * 根据键盘输入对球体施加力
   */
  applyForces() {
    if (!this.rigidBody) return;

    // 唤醒刚体（如果睡眠）
    this.rigidBody.wakeUp();

    const vel = this.rigidBody.linvel();
    const isGrounded = Math.abs(vel.y) < 3;  // 简单地面检测
    const controlMultiplier = isGrounded ? 1.0 : this.params.airControl;

    // 计算力的方向 (相对于世界坐标)
    let forceX = 0;
    let forceZ = 0;

    if (this.keysPressed.w) forceZ -= this.params.force;
    if (this.keysPressed.s) forceZ += this.params.force;
    if (this.keysPressed.a) forceX -= this.params.force;
    if (this.keysPressed.d) forceX += this.params.force;

    // 如果有输入，施加力 (空中控制减弱)
    if (forceX !== 0 || forceZ !== 0) {
      const impulse = {
        x: forceX * 0.016 * controlMultiplier,
        y: 0,
        z: forceZ * 0.016 * controlMultiplier
      };
      this.rigidBody.applyImpulse(impulse, true);
    }

    // 空格键跳跃
    if (this.keysPressed.space) {
      // 更宽松的跳跃条件，允许在斜坡上跳跃
      if (Math.abs(vel.y) < 8) {
        this.rigidBody.applyImpulse({ x: 0, y: this.params.jumpForce, z: 0 }, true);
      }
      this.keysPressed.space = false;  // 单次触发
    }
  }

  /**
   * 同步物理位置到 Three.js 网格
   * @returns {{x: number, y: number, z: number}|null} 当前位置
   */
  syncPosition() {
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
  reset() {
    if (this.rigidBody) {
      this.rigidBody.setTranslation({ x: 0, y: this.params.startHeight, z: 0 }, true);
      this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /**
   * 检查并重置掉出边界的球体
   */
  checkBounds() {
    if (!this.rigidBody) return;
    const pos = this.rigidBody.translation();
    if (pos.y < -100) {
      this.reset();
    }
  }

  /**
   * 获取当前位置
   * @returns {{x: number, y: number, z: number}|null}
   */
  getPosition() {
    if (!this.rigidBody) return null;
    return this.rigidBody.translation();
  }

  /**
   * 更新阻尼参数
   * @param {number} value - 新的阻尼值
   */
  setDamping(value) {
    this.params.damping = value;
    if (this.rigidBody) {
      this.rigidBody.setLinearDamping(value);
    }
  }

  /**
   * 更新摩擦力参数
   * @param {number} value - 新的摩擦力值
   */
  setFriction(value) {
    this.params.friction = value;
    if (this.collider) {
      this.collider.setFriction(value);
    }
  }

  /**
   * 更新弹性参数
   * @param {number} value - 新的弹性值
   */
  setRestitution(value) {
    this.params.restitution = value;
    if (this.collider) {
      this.collider.setRestitution(value);
    }
  }
}

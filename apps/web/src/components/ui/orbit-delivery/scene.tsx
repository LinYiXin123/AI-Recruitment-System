/* eslint-disable -- 第三方生成代码；页面交互在外层 TypeScript 组件中检查。 */
// @ts-nocheck — 用户提供的生成版场景，保留原有骨骼与球面运动代码。
"use client";
// 从用户提供的 Orbit Delivery 组件提取的场景引擎，保留球面行走、招手和背包运动。
// 页面布局与中文交互见 ../orbit-delivery-hero.tsx；资源来源见 public/orbit/来源说明.md。

var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/motion.ts
function stepPlanet(m, dt, auto, reduced, autoRoll = -0.032) {
  m.time += dt;
  if (!auto) {
    m.dragging = false;
    m.planetVelocity = m.pitchVelocity = 0;
    m.dragTarget = m.planetAngle;
    m.pitchTarget = m.pitchAngle;
    return;
  }
  if (m.dragging) {
    const acceleration = 90 * (m.dragTarget - m.planetAngle) - 18 * m.planetVelocity;
    m.planetVelocity += acceleration * dt;
  } else {
    const desired = auto && !reduced && m.time - m.lastInteraction > 3.5 ? autoRoll : 0;
    m.planetVelocity = damp(m.planetVelocity, desired, reduced ? 12 : 5, dt);
  }
  m.planetVelocity = clamp(m.planetVelocity, -1.15, 1.15);
  m.planetAngle += m.planetVelocity * dt;
}
function stepRunner(m, dt, screenTopLocal, reduced) {
  m.characterTarget += Math.atan2(Math.sin(screenTopLocal - m.characterTarget), Math.cos(screenTopLocal - m.characterTarget));
  const error = m.characterTarget - m.characterAngle;
  const stiffness = reduced ? 110 : 48;
  const damping = reduced ? 21 : 11;
  m.characterVelocity += (stiffness * error - damping * m.characterVelocity) * dt;
  m.characterAngle += m.characterVelocity * dt;
  const speed = Math.abs(m.characterVelocity);
  m.activity = damp(m.activity, smoothstep(speed, 4e-3, 0.022), 9, dt);
  if (speed > 0.025) m.direction = Math.sign(m.characterVelocity);
  m.phase += speed * 2.25 / GAIT_DISTANCE * Math.PI * 2 * dt;
}
var clamp, damp, smoothstep, GAIT_DISTANCE, createMotion;
var init_motion = __esm({
  "src/motion.ts"() {
    "use strict";
    clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    damp = (value, target, lambda, dt) => value + (target - value) * (1 - Math.exp(-lambda * dt));
    smoothstep = (value, min, max) => {
      const t = clamp((value - min) / (max - min), 0, 1);
      return t * t * (3 - 2 * t);
    };
    GAIT_DISTANCE = 0.44;
    createMotion = () => ({
      planetAngle: 0,
      planetVelocity: 0,
      dragTarget: 0,
      characterTarget: 0,
      characterAngle: 0,
      characterVelocity: 0,
      phase: 0,
      activity: 0,
      direction: 1,
      time: 0,
      dragging: false,
      lastInteraction: 0,
      pitchAngle: 0,
      pitchVelocity: 0,
      pitchTarget: 0
    });
  }
});

// src/globeMotion.ts
import { Euler, MathUtils, Quaternion, Vector3 } from "three";
function createGlobeMotion() {
  return { delta: new Quaternion(), orientation: new Quaternion().setFromEuler(new Euler(0.1, 0.5, 0)), angular: new Vector3(), route: 0 };
}
function stepGlobeMotion(globe, m, dt, auto, reduced) {
  const roaming = auto && !reduced && !m.dragging && m.time - m.lastInteraction > 3.5;
  if (roaming) globe.route += 0.24 * dt;
  stepPlanet(m, dt, auto, reduced, -0.24 * Math.cos(globe.route));
  if (!auto) {
    globe.angular.set(0, 0, 0);
    return;
  }
  if (m.dragging) m.pitchVelocity += (70 * (m.pitchTarget - m.pitchAngle) - 17 * m.pitchVelocity) * dt;
  else m.pitchVelocity = MathUtils.damp(m.pitchVelocity, roaming ? 0.24 * Math.sin(globe.route) : 0, 6, dt);
  m.pitchVelocity = MathUtils.clamp(m.pitchVelocity, -0.55, 0.55);
  m.pitchAngle += m.pitchVelocity * dt;
  globe.angular.set(m.pitchVelocity, m.planetVelocity * 0.45, -m.planetVelocity);
  const speed = globe.angular.length();
  if (speed > 1e-8) {
    globe.delta.setFromAxisAngle(globe.angular.multiplyScalar(1 / speed), speed * dt);
    globe.orientation.premultiply(globe.delta).normalize();
  }
}
var init_globeMotion = __esm({
  "src/globeMotion.ts"() {
    "use strict";
    init_motion();
  }
});

// src/surfaceMotion.ts
import { Vector3 as Vector32, Quaternion as Quaternion2, MathUtils as MathUtils2 } from "three";
function createSurfaceMotion() {
  return {
    current: new Vector32(0, 1, 0),
    target: new Vector32(0, 1, 0),
    velocity: new Vector32(),
    error: new Vector32(),
    worldNormal: new Vector32(),
    worldVelocity: new Vector32(),
    inverse: new Quaternion2(),
    initialized: false
  };
}
function stepSurface(s, m, rotation, screenUp, dt, reduced, paused = false) {
  s.inverse.copy(rotation).invert();
  s.target.copy(screenUp).applyQuaternion(s.inverse).normalize();
  if (!s.initialized) {
    s.current.copy(s.target);
    s.initialized = true;
  }
  if (paused) {
    s.velocity.set(0, 0, 0);
    s.worldVelocity.set(0, 0, 0);
    s.worldNormal.copy(s.current).applyQuaternion(rotation);
    m.characterVelocity = 0;
    m.activity = MathUtils2.damp(m.activity, 0, 10, dt);
    return;
  }
  const cosine = MathUtils2.clamp(s.current.dot(s.target), -1, 1);
  const angle = Math.acos(cosine);
  s.error.copy(s.target).addScaledVector(s.current, -cosine);
  if (s.error.lengthSq() > 1e-12) s.error.normalize().multiplyScalar(angle);
  const stiffness = reduced ? 110 : 48, damping = reduced ? 21 : 11;
  s.velocity.addScaledVector(s.error, stiffness * dt).multiplyScalar(Math.exp(-damping * dt));
  s.velocity.addScaledVector(s.current, -s.velocity.dot(s.current));
  s.current.addScaledVector(s.velocity, dt).normalize();
  s.velocity.addScaledVector(s.current, -s.velocity.dot(s.current));
  s.worldNormal.copy(s.current).applyQuaternion(rotation);
  s.worldVelocity.copy(s.velocity).applyQuaternion(rotation);
  const speed = s.velocity.length();
  m.characterTarget = Math.atan2(s.target.x, s.target.y);
  m.characterAngle = Math.atan2(s.current.x, s.current.y);
  if (Math.abs(s.worldVelocity.x) > 0.012) m.direction = Math.sign(s.worldVelocity.x);
  m.characterVelocity = speed * m.direction;
  m.activity = MathUtils2.damp(m.activity, MathUtils2.smoothstep(speed, 4e-3, 0.022), 9, dt);
  m.phase += speed * 2.25 / GAIT_DISTANCE * Math.PI * 2 * dt;
}
var init_surfaceMotion = __esm({
  "src/surfaceMotion.ts"() {
    "use strict";
    init_motion();
  }
});

// embedded:assets
import { createContext } from "react";
var AssetBaseContext, surface;
var init_assets = __esm({
  "embedded:assets"() {
    AssetBaseContext = createContext("");
    surface = "models/surface.json";
  }
});

// src/planetAsset.ts
import { useContext } from "react";
import { useEffect, useState } from "react";
import { FrontSide, Mesh, MeshStandardMaterial, SkinnedMesh, Texture } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
function disposeScene(scene) {
  const textures = /* @__PURE__ */ new Set();
  const materials = /* @__PURE__ */ new Set();
  const geometries = /* @__PURE__ */ new Set();
  const skeletons = /* @__PURE__ */ new Set();
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => {
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
  });
}
function usePlanetAsset(onReady) {
  const base = useContext(AssetBaseContext);
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const abort = new AbortController();
    const draco = new DRACOLoader().setDecoderPath("/orbit/draco/").setDecoderConfig({ type: "wasm" }).setWorkerLimit(2);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    let disposed = false;
    let scene;
    const fetchChecked = async (path) => {
      const response = await fetch(path, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) });
      if (!response.ok) throw new Error(`Planet asset could not load (${response.status})`);
      return response;
    };
    onReady?.(false);
    Promise.all([
      fetchChecked(`${base}models/whimsical-world.glb`).then((response) => response.arrayBuffer()),
      fetchChecked(`${base}${surface}`).then((response) => response.json())
    ]).then(async ([buffer, surface2]) => {
      if (disposed) return;
      const gltf = await loader.parseAsync(buffer, `${base}models/`);
      scene = gltf.scene;
      if (disposed) {
        disposeScene(scene);
        return;
      }
      scene.traverse((node) => {
        node.updateMatrix();
        node.matrixAutoUpdate = false;
        if (!(node instanceof Mesh)) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) if (mat instanceof MeshStandardMaterial) {
          mat.side = FrontSide;
          mat.metalness = 0;
          mat.roughness = 0.86;
          mat.normalScale.setScalar(0.65);
          if (mat.map) mat.map.anisotropy = 4;
        }
      });
      setAsset({ scene, surface: surface2 });
      onReady?.(true);
    }).catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason : new Error(String(reason)));
    }).finally(() => {
      if (!disposed) draco.dispose();
    });
    return () => {
      disposed = true;
      abort.abort();
      draco.dispose();
      if (scene) disposeScene(scene);
    };
  }, [onReady, base]);
  if (error) throw error;
  return asset;
}
function surfaceRadius(surface2, x, y, z) {
  const u = (Math.atan2(x, z) / (2 * Math.PI) % 1 + 1) % 1 * surface2.width;
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI * (surface2.height - 1);
  const x0 = Math.floor(u), x1 = (x0 + 1) % surface2.width;
  const y0 = Math.floor(v), y1 = Math.min(y0 + 1, surface2.height - 1);
  const tx = u - x0, ty = v - y0;
  const a = surface2.radii[y0 * surface2.width + x0] * (1 - tx) + surface2.radii[y0 * surface2.width + x1] * tx;
  const b = surface2.radii[y1 * surface2.width + x0] * (1 - tx) + surface2.radii[y1 * surface2.width + x1] * tx;
  return a * (1 - ty) + b * ty;
}
var init_planetAsset = __esm({
  "src/planetAsset.ts"() {
    "use strict";
    init_assets();
  }
});

// src/runCycle.ts
import { AnimationClip, Quaternion as Quaternion3 } from "three";
function makeSeamlessRun(source) {
  const reference = source.tracks.reduce((best, track) => track.times.length > best.times.length ? track : best);
  const start = reference.times[0];
  const last = reference.times[reference.times.length - 1];
  const intervals = Array.from(reference.times).slice(1).map((time, i) => time - reference.times[i]).sort((a, b) => a - b);
  const step = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 1 / 24;
  const period = Math.max(step, last - start + step);
  const frames = Math.max(40, Math.ceil(period * 120));
  const quaternion = new Quaternion3();
  const tracks = source.tracks.map((track) => {
    const count = track.times.length, size = track.getValueSize();
    const knots = Array.from(track.times, (time) => time - start);
    const samples = Array.from(track.values);
    const isRotation = track.name.endsWith(".quaternion");
    const isMorph = track.name.endsWith(".morphTargetInfluences");
    if (isRotation) for (let i = 1; i < count; i++) {
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += samples[(i - 1) * 4 + c] * samples[i * 4 + c];
      if (dot < 0) for (let c = 0; c < 4; c++) samples[i * 4 + c] *= -1;
    }
    const times = [], values = [];
    for (let frame = 0; frame <= frames; frame++) {
      const time = frame === frames ? 0 : frame / frames * period;
      times.push(frame / frames * period);
      let index = 0;
      while (index < count - 1 && knots[index + 1] <= time) index++;
      const previous = (index - 1 + count) % count, next = (index + 1) % count, after = (index + 2) % count;
      const t1 = knots[index], t2 = next === 0 ? period + knots[0] : knots[next];
      const t0 = previous > index ? knots[previous] - period : knots[previous];
      const t3 = after <= next ? knots[after] + period : knots[after];
      const afterTime = t3 <= t2 ? t3 + period : t3;
      const length = Math.max(t2 - t1, 1e-6), u = Math.max(0, Math.min(1, (time - t1) / length));
      for (let c = 0; c < size; c++) {
        const p0 = samples[previous * size + c], p1 = samples[index * size + c], p2 = samples[next * size + c], p3 = samples[after * size + c];
        const a = count < 3 ? 0 : (p2 - p0) / Math.max(t2 - t0, 1e-6) * length;
        const b = count < 3 ? 0 : (p3 - p1) / Math.max(afterTime - t1, 1e-6) * length;
        values.push(count === 1 ? p1 : isMorph ? p1 + (p2 - p1) * u : (2 * u ** 3 - 3 * u ** 2 + 1) * p1 + (u ** 3 - 2 * u ** 2 + u) * a + (-2 * u ** 3 + 3 * u ** 2) * p2 + (u ** 3 - u ** 2) * b);
      }
      if (isRotation) {
        quaternion.fromArray(values, values.length - 4).normalize();
        quaternion.toArray(values, values.length - 4);
      }
    }
    const result = track.clone();
    result.times = new Float32Array(times);
    result.values = new Float32Array(values);
    return result;
  });
  return new AnimationClip("Courier_Run_Seamless", period, tracks);
}
var init_runCycle = __esm({
  "src/runCycle.ts"() {
    "use strict";
  }
});

// src/bagSuspension.ts
import { Bone, Euler as Euler2, MathUtils as MathUtils3, Matrix4, Quaternion as Quaternion4, Vector3 as Vector33 } from "three";
var BagSuspension;
var init_bagSuspension = __esm({
  "src/bagSuspension.ts"() {
    "use strict";
    BagSuspension = class {
      constructor(scene) {
        this.scene = scene;
        const bone = scene.getObjectByName("CourierBag");
        if (!(bone instanceof Bone)) throw new Error("Courier bag attachment is missing.");
        this.bone = bone;
        scene.updateWorldMatrix(true, true);
        scene.getWorldQuaternion(this.sceneOrientation);
        bone.getWorldQuaternion(this.restOrientation);
        this.restOrientation.premultiply(this.sceneOrientation.invert());
        this.inverseRest.copy(this.restOrientation).invert();
      }
      bone;
      restOrientation = new Quaternion4();
      animatedOrientation = new Quaternion4();
      animatedPosition = new Vector33();
      localAnchor = new Vector33();
      gravityTilt = new Quaternion4();
      pelvisYaw = new Quaternion4();
      inverseRest = new Quaternion4();
      xAxis = new Vector33(1, 0, 0);
      hangingOrientation = new Quaternion4();
      sceneOrientation = new Quaternion4();
      parentOrientation = new Quaternion4();
      swing = new Quaternion4();
      angles = new Euler2();
      inverseScene = new Matrix4();
      anchor = new Vector33();
      previousAnchor = new Vector33();
      velocity = new Vector33();
      previousVelocity = new Vector33();
      acceleration = new Vector33();
      initialized = false;
      applied = false;
      pitch = 0;
      roll = 8e-3;
      pitchVelocity = 0;
      rollVelocity = 0;
      restore() {
        if (!this.applied) return;
        this.bone.position.copy(this.animatedPosition);
        this.bone.quaternion.copy(this.animatedOrientation);
        this.applied = false;
      }
      update(dt, activity, _phase, turnRate, reduced, bodyLean = 0) {
        if (dt <= 0 || !this.bone.parent) return;
        this.animatedPosition.copy(this.bone.position);
        this.animatedOrientation.copy(this.bone.quaternion);
        this.inverseScene.copy(this.scene.matrixWorld).invert();
        this.bone.getWorldPosition(this.anchor).applyMatrix4(this.inverseScene);
        if (!this.initialized) {
          this.previousAnchor.copy(this.anchor);
          this.initialized = true;
        }
        this.velocity.copy(this.anchor).sub(this.previousAnchor).divideScalar(dt);
        this.acceleration.copy(this.velocity).sub(this.previousVelocity).divideScalar(dt);
        this.previousVelocity.lerp(this.velocity, 1 - Math.exp(-14 * dt));
        this.previousAnchor.copy(this.anchor);
        const gravity = Math.max(4, 9.81 + this.acceleration.y);
        const targetPitch = reduced ? 0 : MathUtils3.clamp(
          Math.atan2(this.acceleration.z, gravity),
          -0.1,
          0.1
        );
        const targetRoll = reduced ? 0 : MathUtils3.clamp(
          Math.atan2(-this.acceleration.x, gravity) + Math.abs(turnRate) * 1e-3,
          -0.012,
          0.045
        );
        const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
        for (let i = 0; i < steps; i++) {
          this.pitchVelocity += ((targetPitch - this.pitch) * 72 - this.pitchVelocity * 11) * h;
          this.rollVelocity += ((targetRoll - this.roll) * 64 - this.rollVelocity * 10) * h;
          this.pitch = MathUtils3.clamp(this.pitch + this.pitchVelocity * h, -0.12, 0.12);
          this.roll = MathUtils3.clamp(this.roll + this.rollVelocity * h, -0.012, 0.05);
        }
        this.scene.getWorldQuaternion(this.sceneOrientation);
        this.bone.getWorldQuaternion(this.pelvisYaw).premultiply(this.parentOrientation.copy(this.sceneOrientation).invert()).multiply(this.inverseRest);
        this.pelvisYaw.set(0, this.pelvisYaw.y, 0, this.pelvisYaw.w).normalize();
        this.bone.parent.getWorldQuaternion(this.parentOrientation).invert();
        this.swing.setFromEuler(this.angles.set(this.pitch, 0, this.roll));
        this.gravityTilt.setFromAxisAngle(this.xAxis, -bodyLean);
        this.hangingOrientation.copy(this.parentOrientation).multiply(this.sceneOrientation).multiply(this.gravityTilt).multiply(this.pelvisYaw).multiply(this.swing).multiply(this.restOrientation);
        this.bone.quaternion.copy(this.animatedOrientation).slerp(this.hangingOrientation, 1 - activity * 0.3);
        this.localAnchor.copy(this.anchor).addScaledVector(this.xAxis, -9e-3 * (1 - activity * 0.5));
        this.localAnchor.y -= 0.027;
        this.localAnchor.applyMatrix4(this.scene.matrixWorld);
        this.bone.parent.worldToLocal(this.localAnchor);
        this.bone.position.copy(this.localAnchor);
        this.bone.updateWorldMatrix(false, true);
        this.applied = true;
      }
    };
  }
});

// src/courierGreeting.ts
import { Bone as Bone2, MathUtils as MathUtils4, Quaternion as Quaternion5, Vector3 as Vector34 } from "three";
var up, CourierGreeting;
var init_courierGreeting = __esm({
  "src/courierGreeting.ts"() {
    "use strict";
    up = new Vector34(0, 1, 0);
    CourierGreeting = class {
      constructor(scene) {
        this.scene = scene;
        scene.updateWorldMatrix(true, true);
        const inverseScene = scene.getWorldQuaternion(new Quaternion5()).invert();
        this.joints = ["RightArm", "RightForeArm", "RightHand"].map((name) => {
          const bone = scene.getObjectByName(name);
          if (!(bone instanceof Bone2)) throw new Error(`Greeting joint ${name} is missing.`);
          const rest = bone.getWorldQuaternion(new Quaternion5()).premultiply(inverseScene);
          const direction = up.clone().applyQuaternion(rest).normalize();
          const palm = new Vector34(1, 0, 0).addScaledVector(direction, -direction.x).normalize();
          return { bone, rest, direction, palm, animated: bone.quaternion.clone() };
        });
        this.restBendNormal.crossVectors(this.joints[0].direction, this.joints[1].direction).normalize();
      }
      joints;
      sceneRotation = new Quaternion5();
      inverseParent = new Quaternion5();
      aim = new Quaternion5();
      twist = new Quaternion5();
      target = new Quaternion5();
      direction = new Vector34();
      palm = new Vector34();
      wantedPalm = new Vector34();
      cross = new Vector34();
      restBendNormal = new Vector34();
      bendNormal = new Vector34();
      upperDirection = new Vector34(-0.55, -0.65, 0.52).normalize();
      forearmDirection = new Vector34();
      phase = 0;
      applied = false;
      weight = 0;
      restore() {
        if (!this.applied) return;
        for (const joint of this.joints) joint.bone.quaternion.copy(joint.animated);
        this.applied = false;
      }
      step(dt, ready, reduced) {
        this.weight = MathUtils4.damp(this.weight, ready ? 1 : 0, ready ? 4 : 9, dt);
        if (this.weight < 1e-4) {
          this.weight = 0;
          this.phase = 0;
        }
        if (ready && this.weight > 0.85 && !reduced) this.phase += dt * Math.PI * 2 * 0.9;
      }
      apply(reduced) {
        if (this.weight === 0) return;
        this.scene.getWorldQuaternion(this.sceneRotation);
        const wave = Math.sin(this.phase) * (reduced ? 0 : 0.12) * MathUtils4.smoothstep(this.weight, 0.85, 0.99);
        this.forearmDirection.set(-0.08 + wave * 0.35, 0.94, 0.33).normalize();
        this.bendNormal.crossVectors(this.upperDirection, this.forearmDirection).normalize();
        this.joints.forEach((joint, index) => {
          joint.animated.copy(joint.bone.quaternion);
          if (index === 0) this.direction.copy(this.upperDirection);
          else if (index === 1) this.direction.copy(this.forearmDirection);
          else this.direction.set(-0.06 + wave, 0.97, 0.22);
          this.direction.normalize();
          this.aim.setFromUnitVectors(joint.direction, this.direction);
          this.target.copy(this.aim).multiply(joint.rest);
          this.palm.copy(this.restBendNormal).addScaledVector(joint.direction, -this.restBendNormal.dot(joint.direction)).normalize().applyQuaternion(this.aim);
          this.wantedPalm.copy(this.bendNormal).addScaledVector(this.direction, -this.bendNormal.dot(this.direction)).normalize();
          const angle = Math.atan2(this.direction.dot(this.cross.crossVectors(this.palm, this.wantedPalm)), this.palm.dot(this.wantedPalm));
          this.twist.setFromAxisAngle(this.direction, angle);
          this.target.premultiply(this.twist);
          joint.bone.parent.getWorldQuaternion(this.inverseParent).invert();
          this.target.premultiply(this.sceneRotation).premultiply(this.inverseParent);
          joint.bone.quaternion.slerp(this.target, this.weight);
          joint.bone.updateWorldMatrix(false, true);
        });
        this.applied = true;
      }
    };
  }
});

// src/sceneOptimization.ts
import { Matrix4 as Matrix42, Mesh as Mesh2, SkinnedMesh as SkinnedMesh2 } from "three";
function optimizeRigidBag(scene) {
  scene.updateWorldMatrix(true, true);
  const candidates = [];
  scene.traverse((node) => {
    if (node instanceof SkinnedMesh2 && node.name.startsWith("Delivery_Bag")) candidates.push(node);
  });
  for (const mesh of candidates) {
    if (Object.keys(mesh.geometry.morphAttributes).length) continue;
    const weights = mesh.geometry.getAttribute("skinWeight");
    const indices = mesh.geometry.getAttribute("skinIndex");
    if (!weights || !indices) continue;
    let joint = -1, rigid = true;
    for (let vertex = 0; vertex < weights.count && rigid; vertex++) {
      let total = 0;
      for (let channel = 0; channel < 4; channel++) {
        const weight = weights.getComponent(vertex, channel);
        if (weight < 1e-6) continue;
        const index = indices.getComponent(vertex, channel);
        if (joint < 0) joint = index;
        if (index !== joint) {
          rigid = false;
          break;
        }
        total += weight;
      }
      if (Math.abs(total - 1) > 1e-4) rigid = false;
    }
    if (!rigid || joint < 0) continue;
    const bone = mesh.skeleton.bones[joint];
    const bind = new Matrix42().multiplyMatrices(mesh.skeleton.boneInverses[joint], mesh.bindMatrix);
    const geometry = mesh.geometry.clone().applyMatrix4(bind);
    geometry.deleteAttribute("skinIndex");
    geometry.deleteAttribute("skinWeight");
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const bag = new Mesh2(geometry, mesh.material);
    bag.name = mesh.name;
    bag.castShadow = mesh.castShadow;
    bag.receiveShadow = mesh.receiveShadow;
    bag.renderOrder = mesh.renderOrder;
    bag.matrixAutoUpdate = false;
    mesh.removeFromParent();
    bone.add(bag);
    let shared = false;
    scene.traverse((node) => {
      if (node instanceof Mesh2 && node.geometry === mesh.geometry) shared = true;
    });
    if (!shared) mesh.geometry.dispose();
  }
}
var init_sceneOptimization = __esm({
  "src/sceneOptimization.ts"() {
    "use strict";
  }
});

// src/Courier.tsx
import { useContext as useContext2 } from "react";
import { useEffect as useEffect2, useRef, useState as useState2 } from "react";
import { useFrame } from "@react-three/fiber";
import { AnimationClip as AnimationClip2, AnimationMixer, Bone as Bone3, LoopRepeat, MathUtils as MathUtils5, Mesh as Mesh3, MeshStandardMaterial as MeshStandardMaterial2, NumberKeyframeTrack, Quaternion as Quaternion6, QuaternionKeyframeTrack, SkinnedMesh as SkinnedMesh3, Vector3 as Vector35, VectorKeyframeTrack } from "three";
import { GLTFLoader as GLTFLoader2 } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader as DRACOLoader2 } from "three/examples/jsm/loaders/DRACOLoader.js";
function makeIdle(scene) {
  const tracks = [];
  const breath = new Quaternion6().setFromAxisAngle(new Vector35(1, 0, 0), 9e-3);
  scene.traverse((node) => {
    if (node instanceof Mesh3 && node.morphTargetInfluences?.length) {
      const zeros = new Array(node.morphTargetInfluences.length).fill(0);
      tracks.push(new NumberKeyframeTrack(`${node.name}.morphTargetInfluences`, [0, 3], [...zeros, ...zeros]));
    }
    if (!(node instanceof Bone3)) return;
    const q = node.quaternion.clone(), middle = q.clone();
    if (node.name === "Spine02" || node.name === "neck") middle.multiply(breath);
    tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, [0, 1.5, 3], [...q.toArray(), ...middle.toArray(), ...q.toArray()]));
    const p = node.position.clone(), inhale = p.clone();
    if (node.name === "Hips") inhale.y += 4e-3;
    tracks.push(new VectorKeyframeTrack(`${node.name}.position`, [0, 1.5, 3], [...p.toArray(), ...inhale.toArray(), ...p.toArray()]));
    tracks.push(new VectorKeyframeTrack(`${node.name}.scale`, [0, 3], [...node.scale.toArray(), ...node.scale.toArray()]));
  });
  return new AnimationClip2("Courier_Idle", 3, tracks);
}
function Courier({ motion, paused, reduced, onReady }) {
  const base = useContext2(AssetBaseContext);
  const facing = useRef(null), lean = useRef(null);
  const greetingTurn = useRef(false);
  const turnVelocity = useRef(0);
  const [asset, setAsset] = useState2(null);
  const [error, setError] = useState2(null);
  useEffect2(() => {
    const abort = new AbortController();
    const draco = new DRACOLoader2().setDecoderPath("/orbit/draco/").setDecoderConfig({ type: "wasm" }).setWorkerLimit(1);
    const loader = new GLTFLoader2().setDRACOLoader(draco);
    let cancelled = false;
    let owned;
    onReady?.(false);
    const modelFile = "courier.glb";
    fetch(`${base}models/${modelFile}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) }).then(async (response) => {
      if (!response.ok) throw new Error(`Courier could not load (${response.status})`);
      const data = await response.arrayBuffer();
      if (cancelled) return;
      const gltf = await loader.parseAsync(data, `${base}models/`);
      if (cancelled) {
        disposeScene(gltf.scene);
        return;
      }
      optimizeRigidBag(gltf.scene);
      gltf.scene.traverse((node) => {
        if (!(node instanceof Mesh3)) return;
        node.morphTargetInfluences?.fill(0);
        if (node instanceof SkinnedMesh3) node.frustumCulled = false;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof MeshStandardMaterial2) {
            material.metalness = 0;
            material.roughness = 0.9;
            material.roughnessMap = null;
            material.normalScale.setScalar(0.25);
            if (material.map) material.map.anisotropy = 8;
          }
        }
      });
      const clips = gltf.animations.filter((animation) => animation.duration > 0.3);
      if (!clips.length) {
        disposeScene(gltf.scene);
        throw new Error("The courier run animation is missing.");
      }
      const clip = new AnimationClip2("Courier_Run_Source", -1, clips.flatMap((animation) => animation.tracks));
      const mixer = new AnimationMixer(gltf.scene);
      const bag = new BagSuspension(gltf.scene);
      const greeting = new CourierGreeting(gltf.scene);
      const idle = mixer.clipAction(makeIdle(gltf.scene)).play();
      const seamless = makeSeamlessRun(clip);
      const run = mixer.clipAction(seamless).setLoop(LoopRepeat, Infinity).play();
      run.zeroSlopeAtStart = false;
      run.zeroSlopeAtEnd = false;
      run.setEffectiveTimeScale(0);
      run.setEffectiveWeight(0);
      mixer.update(0);
      owned = { scene: gltf.scene, mixer, idle, run, duration: seamless.duration, bag, greeting };
      setAsset(owned);
      onReady?.(true);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
    }).finally(() => {
      if (!cancelled) draco.dispose();
    });
    return () => {
      cancelled = true;
      abort.abort();
      draco.dispose();
      if (owned) {
        owned.mixer.stopAllAction();
        owned.mixer.uncacheRoot(owned.scene);
        disposeScene(owned.scene);
      }
    };
  }, [onReady, base]);
  useFrame((_, delta) => {
    if (!asset) return;
    const dt = Math.min(delta, 0.05), m = motion.current;
    if (!paused) greetingTurn.current = false;
    else if (m.activity < 0.06) greetingTurn.current = true;
    const desired = paused ? greetingTurn.current ? m.cameraHeading ?? 0 : facing.current.rotation.y : (m.heading ?? 0) + Math.PI / 2;
    const turn = Math.atan2(Math.sin(desired - facing.current.rotation.y), Math.cos(desired - facing.current.rotation.y));
    if (paused) {
      const acceleration = MathUtils5.clamp(18 * turn - 8.5 * turnVelocity.current, -5.5, 5.5);
      turnVelocity.current = MathUtils5.clamp(turnVelocity.current + acceleration * dt, -2.2, 2.2);
      if (Math.abs(turn) < 3e-3 && Math.abs(turnVelocity.current) < 0.025) turnVelocity.current = 0;
      facing.current.rotation.y += turnVelocity.current * dt;
    } else {
      const rotation = turn * (1 - Math.exp(-12 * dt));
      facing.current.rotation.y += rotation;
      turnVelocity.current = rotation / dt;
    }
    const turning = paused && greetingTurn.current && !reduced ? MathUtils5.smoothstep(Math.abs(turnVelocity.current), 0.08, 1.2) : 0;
    asset.greeting.step(dt, paused && greetingTurn.current && Math.abs(turn) < 0.055 && Math.abs(turnVelocity.current) < 0.13, reduced);
    lean.current.rotation.x = MathUtils5.damp(lean.current.rotation.x, Math.min(Math.abs(m.characterVelocity) * 0.065, 0.09) * (reduced ? 0.35 : 1), 9, dt);
    const activity = Math.max(m.activity, turning * 0.3) * (1 - asset.greeting.weight);
    asset.run.setEffectiveWeight(activity);
    asset.idle.setEffectiveWeight(1 - activity);
    asset.idle.paused = reduced;
    const playback = Math.max(Math.abs(m.characterVelocity) * 2.25 / GAIT_DISTANCE * asset.duration, turning * 0.72);
    asset.run.setEffectiveTimeScale(MathUtils5.damp(asset.run.timeScale, playback, 10, dt));
    asset.greeting.restore();
    asset.bag.restore();
    asset.mixer.update(dt);
    asset.scene.updateWorldMatrix(true, true);
    asset.greeting.apply(reduced);
    asset.bag.update(dt, activity, m.phase, turnVelocity.current, reduced, lean.current.rotation.x);
  });
  if (error) throw error;
  return <group ref={facing} rotation={[0, Math.PI / 2, 0]}><group ref={lean}><group scale={MODEL_SCALE}>{asset && <primitive object={asset.scene} dispose={null} />}</group></group></group>;
}
var MODEL_SCALE;
var init_Courier = __esm({
  "src/Courier.tsx"() {
    "use strict";
    init_assets();
    init_planetAsset();
    init_motion();
    init_runCycle();
    init_bagSuspension();
    init_courierGreeting();
    init_sceneOptimization();
    MODEL_SCALE = 0.76 / 1.7;
  }
});

// src/renderQuality.ts
function chooseRenderQuality() {
  if (typeof navigator === "undefined") return "low";
  const device = navigator;
  const mobile = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900;
  const limited = (device.hardwareConcurrency || 4) <= 4 || device.deviceMemory !== void 0 && device.deviceMemory <= 4;
  const slowConnection = device.connection?.saveData || /(^|-)2g$/.test(device.connection?.effectiveType || "");
  return mobile || limited || slowConnection ? "low" : "high";
}
var renderQuality;
var init_renderQuality = __esm({
  "src/renderQuality.ts"() {
    "use strict";
    renderQuality = chooseRenderQuality();
  }
});

// src/AdaptiveResolution.tsx
import { useEffect as useEffect4, useRef as useRef3 } from "react";
import { useFrame as useFrame3, useThree as useThree2 } from "@react-three/fiber";
function AdaptiveResolution({ active }) {
  const setDpr = useThree2((state) => state.setDpr);
  const maximum = Math.min((typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1, renderQuality === "low" ? 1.25 : 2);
  const minimum = Math.min(maximum, renderQuality === "low" ? 1 : 1.25);
  const sample = useRef3({ warmup: 3, time: 0, frames: 0, goodWindows: 0, dpr: maximum });
  useEffect4(() => {
    sample.current.warmup = 3;
    sample.current.time = 0;
    sample.current.frames = 0;
    sample.current.goodWindows = 0;
  }, [active]);
  useFrame3((state, delta) => {
    const s = sample.current;
    if (!active || delta <= 0) return;
    if (s.warmup > 0) {
      s.warmup -= Math.min(delta, 0.1);
      return;
    }
    if (delta > 0.12) {
      s.time = 0;
      s.frames = 0;
      return;
    }
    s.time += delta;
    s.frames++;
    if (s.time < 2) return;
    const frameTime = s.time / s.frames;
    s.dpr = state.viewport.dpr;
    let next = s.dpr;
    if (frameTime > 1 / 48) {
      next = Math.max(minimum, s.dpr - 0.25);
      s.goodWindows = 0;
    } else if (frameTime < 1 / 57) {
      if (++s.goodWindows >= 4) {
        next = Math.min(maximum, s.dpr + 0.25);
        s.goodWindows = 0;
      }
    } else s.goodWindows = 0;
    s.time = 0;
    s.frames = 0;
    if (next !== s.dpr) {
      s.dpr = next;
      setDpr(next);
      s.warmup = 1;
    }
  });
  return null;
}
var init_AdaptiveResolution = __esm({
  "src/AdaptiveResolution.tsx"() {
    "use strict";
    init_renderQuality();
  }
});

// src/PlanetScene.tsx
var PlanetScene_exports = {};
__export(PlanetScene_exports, {
  default: () => PlanetScene2
});
import { useEffect as useEffect5, useMemo, useRef as useRef4, useState as useState3 } from "react";
import { Canvas as Canvas2, useFrame as useFrame4, useThree as useThree3 } from "@react-three/fiber";
import { MathUtils as MathUtils6, Quaternion as Quaternion8, Vector3 as Vector37 } from "three";
function ResponsiveCamera() {
  const { size, camera } = useThree3();
  useEffect5(() => {
    const ortho = camera;
    ortho.zoom = size.width / (size.width < 700 ? 5.65 : 5.25);
    ortho.updateProjectionMatrix();
  }, [size.width, size.height, camera]);
  return null;
}
function World2({ motion, auto, reduced, onReady }) {
  const planet = useRef4(null), runner = useRef4(null);
  const asset = usePlanetAsset();
  const [courierReady, setCourierReady] = useState3(false);
  useEffect5(() => {
    onReady?.(!!asset && courierReady);
  }, [asset, courierReady, onReady]);
  const radius = useRef4(2.2);
  const surface2 = useRef4(createSurfaceMotion());
  const globe = useMemo(createGlobeMotion, []);
  const frame = useMemo(() => ({ screenUp: new Vector37(), localVelocity: new Vector37(), cameraFront: new Vector37(), inverseRunner: new Quaternion8() }), []);
  const size = useThree3((state) => state.size);
  const small = size.width < 700;
  const zoom = size.width / (small ? 5.65 : 5.25);
  const centerY = size.height / zoom * (small ? 0.08 : 0.19) - 2.17;
  useFrame4(({ camera }, delta) => {
    if (!asset || !courierReady) return;
    const m = motion.current;
    const elapsed = Math.min(delta, 0.05), count = Math.ceil(elapsed / (1 / 120));
    frame.screenUp.copy(up3).applyQuaternion(camera.quaternion);
    for (let i = 0; i < count; i++) {
      const dt = elapsed / count;
      stepGlobeMotion(globe, m, dt, auto, reduced);
      stepSurface(surface2.current, m, globe.orientation, frame.screenUp, dt, reduced, !auto);
    }
    planet.current.quaternion.copy(globe.orientation);
    const s = surface2.current;
    const r = surfaceRadius(asset.surface, s.current.x, s.current.y, s.current.z) * 2.25;
    radius.current = MathUtils6.damp(radius.current, r + 8e-3, 25, elapsed);
    runner.current.position.copy(s.worldNormal).multiplyScalar(radius.current);
    runner.current.quaternion.setFromUnitVectors(up3, s.worldNormal);
    frame.inverseRunner.copy(runner.current.quaternion).invert();
    frame.cameraFront.set(0, 0, 1).applyQuaternion(camera.quaternion).applyQuaternion(frame.inverseRunner);
    m.cameraHeading = Math.atan2(frame.cameraFront.x, frame.cameraFront.z);
    if (s.velocity.lengthSq() > 1e-4) {
      frame.localVelocity.copy(s.worldVelocity).applyQuaternion(frame.inverseRunner);
      m.heading = Math.atan2(-frame.localVelocity.z, frame.localVelocity.x);
    }
  }, -1);
  return <group position={[0, centerY, 0]}>
    <group ref={planet} scale={2.25}>{asset && <primitive object={asset.scene} dispose={null} />}</group>
    <group ref={runner} visible={!!asset && courierReady}><Courier motion={motion} paused={!auto} reduced={reduced} onReady={setCourierReady} /></group>
  </group>;
}
function PlanetScene2(props) {
  const lowPower = renderQuality === "low";
  return <Canvas2 fallback={<p>当前浏览器无法显示三维场景，可以继续向下了解知遇。</p>} onCreated={({ gl }) => { gl.domElement.addEventListener("webglcontextlost", props.onFailure, { once: true }); }} orthographic camera={{ position: [0, 0, 9], zoom: 150, near: 0.1, far: 30 }} dpr={lowPower ? [1, 1.25] : [1, 2]} frameloop={props.active ? "always" : "never"} gl={{ antialias: true, alpha: true, powerPreference: lowPower ? "low-power" : "high-performance" }}>
    <ResponsiveCamera />
    <AdaptiveResolution active={props.active} />
    <ambientLight intensity={0.9} /><hemisphereLight args={["#f1f5ff", "#8aabc5", 1.4]} />
    <directionalLight position={[-3, 5, 5]} intensity={2.6} color="#fff8f1" />
    <directionalLight position={[3, 2, -2]} intensity={1.8} color="#c5deff" />
    <World2 {...props} />
  </Canvas2>;
}
var up3;
var init_PlanetScene = __esm({
  "src/PlanetScene.tsx"() {
    "use strict";
    init_globeMotion();
    init_surfaceMotion();
    init_planetAsset();
    init_Courier();
    init_renderQuality();
    init_AdaptiveResolution();
    up3 = new Vector37(0, 1, 0);
  }
});


init_PlanetScene();

export default function OrbitScene({ assetBaseUrl, ...props }: import("../orbit-delivery-hero").OrbitSceneProps) {
  return <AssetBaseContext.Provider value={assetBaseUrl.replace(/\/$/, "") + "/"}><PlanetScene2 {...props} /></AssetBaseContext.Provider>;
}

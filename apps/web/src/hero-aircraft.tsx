"use client";

import { useEffect, useRef } from "react";
import {
  Box3, Euler, Group,
  Material, Matrix4, Mesh, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Quaternion, Raycaster,
  Scene, Vector2, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FlightClock, flightPose } from "./hero-flight-motion";
import { finishAircraft } from "./hero-aircraft-materials";
import { createAircraftFans } from "./hero-aircraft-fans";
import { createAircraftLights } from "./hero-aircraft-lights";
import { createAircraftLighting } from "./hero-aircraft-lighting";

type Options = { playing: boolean; visible: boolean; reducedMotion: boolean };
type Props = Options & { onReady(): void; onError(): void };
type Controller = { update(options: Options): void; dispose(): void };

function disposeModel(model: Group) {
  const materials = new Set<Material>();
  model.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  materials.forEach(material => material.dispose());
}

function createAircraft(host: HTMLDivElement, onReady: () => void, onError: () => void): Controller {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0, 0);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(16, 1, .5, 500);
  const aircraft = new Group();
  scene.add(aircraft);
  const lighting = createAircraftLighting(scene, renderer);

  const clock = new FlightClock();
  const offset = new Quaternion();
  const released = new Quaternion();
  const identity = new Quaternion();
  const base = new Quaternion();
  const euler = new Euler();
  const deltaRotation = new Quaternion();
  const trackball = new Vector3();
  const previousTrackball = new Vector3();
  const ray = new Raycaster();
  const pointer = new Vector2();
  const projected = new Vector3();
  let options: Options = { playing: false, visible: true, reducedMotion: true };
  let model: Group | undefined;
  let disposed = false;
  let frame = 0;
  let lastTime = 0;
  let captured: number | undefined;
  let keyboardHeld = false;
  let cameraDistance = 40;
  let width = 1;
  let height = 1;
  let diagnosticTime = 0;
  let vertices: Vector3[] = [];
  let fans: Group[] = [];
  let fanPhase = 0;
  let effectsTime = 0;
  let lights: ReturnType<typeof createAircraftLights> | undefined;

  function invalidate() {
    if (!disposed && options.visible && !frame) frame = requestAnimationFrame(render);
  }

  function render(time: number) {
    frame = 0;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
    lastTime = time;
    clock.advance(dt, options.playing, options.reducedMotion);
    if (options.playing) {
      effectsTime += dt;
      fanPhase = (fanPhase + dt * 1.35) % 1;
    }
    fans.forEach((fan, index) => { fan.rotation.x = fanPhase * Math.PI * 2 + index * .4; });
    lights?.update(effectsTime);
    if (clock.mode !== "drag") offset.slerpQuaternions(released, identity, clock.returnProgress);
    const pose = flightPose(clock.seconds);
    const distance = cameraDistance * (1 + .34 * pose.retreat);
    const halfHeight = distance * Math.tan(camera.fov * Math.PI / 360);
    base.setFromEuler(euler.set(pose.bank, pose.yaw, pose.pitch, "YXZ"));
    aircraft.quaternion.copy(offset).multiply(base);
    aircraft.position.set(pose.sway - halfHeight * camera.aspect * .02, -halfHeight * .16 + pose.lift, cameraDistance - distance);
    lighting.update(aircraft.position);
    scene.updateMatrixWorld();
    renderer.render(scene, camera);

    // Low-frequency diagnostics also make the real WebGL interaction observable to tests.
    if (time - diagnosticTime > 120 || clock.mode !== host.dataset.motion || clock.mode !== "flight" || !options.playing) {
      diagnosticTime = time;
      host.dataset.motion = clock.mode;
      host.dataset.flightTime = clock.seconds.toFixed(4);
      host.dataset.rotationOffset = identity.angleTo(offset).toFixed(5);
      host.dataset.fanPhase = fanPhase.toFixed(4);
      host.dataset.fanCenters = JSON.stringify(fans.map(fan => {
        fan.getWorldPosition(projected).project(camera);
        return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 };
      }));
      if (model) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const vertex of vertices) {
          projected.copy(vertex).applyMatrix4(aircraft.matrixWorld).project(camera);
          minX = Math.min(minX, projected.x); maxX = Math.max(maxX, projected.x);
          minY = Math.min(minY, projected.y); maxY = Math.max(maxY, projected.y);
        }
        host.dataset.aircraftBounds = JSON.stringify({ x: (minX + 1) * width / 2, y: (1 - maxY) * height / 2, width: (maxX - minX) * width / 2, height: (maxY - minY) * height / 2 });
      }
    }
    if (options.playing || clock.mode !== "flight") invalidate();
    else lastTime = 0;
  }

  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    camera.aspect = width / height;
    cameraDistance = Math.max(79, 44 / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect * 1.18));
    camera.position.set(0, 0, cameraDistance);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    invalidate();
  }

  function overAircraft(event: PointerEvent) {
    if (!model) return false;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / width * 2 - 1, 1 - (event.clientY - rect.top) / height * 2);
    ray.setFromCamera(pointer, camera);
    return ray.intersectObject(model, true).length > 0;
  }

  function toTrackball(event: PointerEvent, output: Vector3) {
    const rect = canvas.getBoundingClientRect();
    const radius = Math.min(width * .36, height * .55);
    const x = (event.clientX - rect.left - width / 2) / radius;
    const y = (height * .73 - (event.clientY - rect.top)) / radius;
    const length = x * x + y * y;
    return output.set(x, y, length < .5 ? Math.sqrt(1 - length) : .5 / Math.sqrt(length)).normalize();
  }

  function beginDrag(event: PointerEvent) {
    if (event.button !== 0 || captured !== undefined || !overAircraft(event)) return;
    captured = event.pointerId;
    keyboardHeld = false;
    clock.grab();
    toTrackball(event, previousTrackball);
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    host.dataset.input = "pointer";
    host.focus({ preventScroll: true });
    event.preventDefault();
    invalidate();
  }

  function moveDrag(event: PointerEvent) {
    if (captured !== event.pointerId) {
      if (captured === undefined) canvas.style.cursor = overAircraft(event) ? "grab" : "default";
      return;
    }
    toTrackball(event, trackball);
    deltaRotation.setFromUnitVectors(previousTrackball, trackball);
    offset.premultiply(deltaRotation).normalize();
    previousTrackball.copy(trackball);
    invalidate();
  }

  function returnToFlight() {
    if (clock.mode === "flight") return;
    released.copy(offset);
    clock.release(options.reducedMotion);
    if (options.reducedMotion) offset.identity();
    keyboardHeld = false;
    canvas.style.cursor = "grab";
    invalidate();
  }

  function endDrag(event?: PointerEvent) {
    if (captured === undefined || (event && event.pointerId !== captured)) return;
    const id = captured;
    captured = undefined;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    returnToFlight();
  }

  const arrowAxes: Record<string, Vector3> = {
    ArrowLeft: new Vector3(0, -1, 0), ArrowRight: new Vector3(0, 1, 0),
    ArrowUp: new Vector3(-1, 0, 0), ArrowDown: new Vector3(1, 0, 0),
  };
  function keyDown(event: KeyboardEvent) {
    host.dataset.input = "keyboard";
    if (arrowAxes[event.key] && model) {
      event.preventDefault();
      if (captured !== undefined) return;
      keyboardHeld = true;
      clock.grab();
      offset.premultiply(deltaRotation.setFromAxisAngle(arrowAxes[event.key], .12)).normalize();
      invalidate();
    } else if (event.key === "Escape") { endDrag(); returnToFlight(); }
  }
  function keyUp(event: KeyboardEvent) { if (keyboardHeld && arrowAxes[event.key]) returnToFlight(); }
  function blur() { delete host.dataset.input; endDrag(); returnToFlight(); }
  function contextLost(event: Event) { event.preventDefault(); onError(); }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  canvas.addEventListener("pointerdown", beginDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);
  canvas.addEventListener("webglcontextlost", contextLost);
  host.addEventListener("keydown", keyDown);
  host.addEventListener("keyup", keyUp);
  host.addEventListener("blur", blur);
  window.addEventListener("blur", blur);

  new GLTFLoader().load("/hero/boeing-707.glb", async gltf => {
    await lighting.ready;
    if (disposed) { disposeModel(gltf.scene); return; }
    model = gltf.scene;
    finishAircraft(model);
    aircraft.add(model);
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty()) { onError(); return; }
    const point = new Vector3();
    const inverse = aircraft.matrixWorld.clone().invert();
    const local = new Matrix4();
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      local.multiplyMatrices(inverse, object.matrixWorld);
      for (let i = 0; i < positions.count; i += 8) vertices.push(point.fromBufferAttribute(positions, i).applyMatrix4(local).clone());
    });
    fans = createAircraftFans(model);
    lights = createAircraftLights(model);
    aircraft.add(lights.group);
    host.dataset.ready = "true";
    onReady();
    invalidate();
  }, undefined, () => { if (!disposed) onError(); });

  return {
    update(next) {
      options = next;
      if (!next.visible) {
        endDrag(); returnToFlight();
        cancelAnimationFrame(frame); frame = 0; lastTime = 0;
      } else invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("blur", blur);
      host.removeEventListener("blur", blur);
      host.removeEventListener("keydown", keyDown);
      host.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", beginDrag);
      canvas.removeEventListener("pointermove", moveDrag);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("lostpointercapture", endDrag);
      canvas.removeEventListener("webglcontextlost", contextLost);
      if (model) disposeModel(model);
      lights?.dispose();
      vertices = [];
      lighting.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export default function HeroAircraft({ playing, visible, reducedMotion, onReady, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  useEffect(() => {
    try { controller.current = createAircraft(host.current!, onReady, onError); }
    catch { onError(); }
    return () => { controller.current?.dispose(); controller.current = null; };
  }, [onReady, onError]);
  useEffect(() => { controller.current?.update({ playing, visible, reducedMotion }); }, [playing, visible, reducedMotion]);
  return <div ref={host} className="hero-aircraft-3d" role="region" tabIndex={0}
    aria-label="可旋转的波音 707 飞机模型" aria-describedby="aircraft-controls">
    <span id="aircraft-controls" className="sr-only">拖动或使用方向键旋转飞机，松开后自动回位。按 Escape 复位。</span>
  </div>;
}

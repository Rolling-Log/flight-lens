import {
  Color, DirectionalLight, FloatType, PMREMGenerator, Scene, Vector3, WebGLRenderer,
} from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export function createAircraftLighting(scene: Scene, renderer: WebGLRenderer) {
  const sun = new DirectionalLight(0xfff7ec, 2.4);
  const direction = new Vector3(-24, 45, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 115 });
  sun.shadow.bias = -.0006;
  sun.shadow.normalBias = .055;
  scene.add(sun, sun.target);
  scene.environmentIntensity = .7;
  scene.environmentRotation.y = -1.74;
  let disposed = false;
  let environment: ReturnType<PMREMGenerator["fromEquirectangular"]> | undefined;

  const ready = new HDRLoader().setDataType(FloatType).loadAsync("/hero/sky-environment.hdr").then(texture => {
    if (disposed) { texture.dispose(); return; }
    const { data, width, height } = texture.image as { data: Float32Array; width: number; height: number };
    const flux = new Color(0, 0, 0);
    const solarDirection = new Vector3();
    const ray = new Vector3();
    // Move the HDR's solar disc into a shadow-casting light, keeping its energy and direction.
    // Leaving it in both sources would illuminate cavities twice and produce conflicting highlights.
    for (let y = 0; y < height; y++) {
      const elevation = (.5 - (y + .5) / height) * Math.PI;
      const cosElevation = Math.cos(elevation);
      const solidAngle = cosElevation * 2 * Math.PI * Math.PI / (width * height);
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const luminance = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
        if (luminance <= 40) continue;
        const solarFraction = 1 - 40 / luminance;
        const azimuth = ((x + .5) / width - .5) * 2 * Math.PI;
        ray.set(cosElevation * Math.cos(azimuth), Math.sin(elevation), cosElevation * Math.sin(azimuth));
        solarDirection.addScaledVector(ray, luminance * solarFraction * solidAngle);
        flux.r += data[i] * solarFraction * solidAngle;
        flux.g += data[i + 1] * solarFraction * solidAngle;
        flux.b += data[i + 2] * solarFraction * solidAngle;
        data[i] *= 1 - solarFraction;
        data[i + 1] *= 1 - solarFraction;
        data[i + 2] *= 1 - solarFraction;
      }
    }
    const peak = Math.max(flux.r, flux.g, flux.b);
    if (peak > 0) {
      sun.color.copy(flux).multiplyScalar(1 / peak);
      sun.intensity = peak * scene.environmentIntensity;
      direction.copy(solarDirection).normalize().applyEuler(scene.environmentRotation).multiplyScalar(57);
    }
    texture.needsUpdate = true;
    const pmrem = new PMREMGenerator(renderer);
    environment = pmrem.fromEquirectangular(texture);
    scene.environment = environment.texture;
    texture.dispose();
    pmrem.dispose();
  }, () => { /* The directional daylight also serves as the network-failure fallback. */ });

  return {
    ready,
    update(position: Vector3) {
      sun.position.copy(position).add(direction);
      sun.target.position.copy(position);
    },
    dispose() {
      disposed = true;
      environment?.dispose();
      sun.shadow.dispose();
    },
  };
}

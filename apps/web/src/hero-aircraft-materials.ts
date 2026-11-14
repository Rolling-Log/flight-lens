import { Color, Group, Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from "three";

const surfaceDetail = /* glsl */`
  float finishHash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float finishNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(finishHash(i), finishHash(i + vec3(1,0,0)), f.x),
          mix(finishHash(i + vec3(0,1,0)), finishHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(finishHash(i + vec3(0,0,1)), finishHash(i + vec3(1,0,1)), f.x),
          mix(finishHash(i + vec3(0,1,1)), finishHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec3 finishNormal(vec3 n, float height) {
    vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
    vec3 rx = cross(dy, n), ry = cross(n, dx);
    float determinant = dot(dx, rx);
    return normalize(abs(determinant) * n - sign(determinant) * (dFdx(height) * rx + dFdy(height) * ry));
  }
`;

export function finishAircraft(model: Group) {
  const replacements = new Map<string, MeshPhysicalMaterial>();
  const originals = new Set<Material>();
  model.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const nacelle = [1, 10, 13, 18].includes(object.userData.cad_body);
    const fan = [4, 11, 14, 15].includes(object.userData.cad_body);
    if (nacelle || fan) object.geometry.computeBoundingBox();
    const intake = nacelle ? object.geometry.boundingBox!.max.x : null;
    const fanCenter = fan ? object.geometry.boundingBox!.getCenter(new Vector3()) : null;
    const finish = (source: MeshStandardMaterial) => {
      const key = `${source.uuid}:${intake ?? fanCenter?.toArray().join(",") ?? "skin"}`;
      const existing = replacements.get(key);
      if (existing) return existing;
      const material = new MeshPhysicalMaterial({
        name: source.name,
        color: source.color,
        side: source.side,
        vertexColors: source.vertexColors,
      });
      material.metalness = 0;
      material.roughness = .48;
      material.clearcoat = 1;
      material.clearcoatRoughness = .085;
      material.ior = 1.5;
      material.specularIntensity = .3;
      const painted = /glacier|porcelain|midnight/.test(source.name) && !fan;
      if (source.name.includes("glacier")) {
        material.color = new Color("#6daccb");
        // The blue livery is a metallic-effect basecoat under a dielectric clear finish.
        material.metalness = .42;
        material.roughness = .24;
      } else if (source.name.includes("porcelain")) {
        material.color = new Color("#dfe6e9");
        material.clearcoatRoughness = .11;
      } else if (source.name.includes("midnight")) {
        material.color = new Color("#163249");
      } else if (source.name.includes("glass")) {
        material.color = new Color("#0e1921");
        material.roughness = .045;
        material.clearcoat = 0;
        material.ior = 1.52;
        material.specularIntensity = 1;
      } else if (source.name.includes("aluminium")) {
        material.color = new Color("#d6d9dd");
        material.metalness = 1;
        material.roughness = .23;
        material.clearcoat = 0;
        material.specularIntensity = 1;
      } else if (source.name.includes("interior")) {
        material.color = new Color("#293038");
        material.metalness = 1;
        material.roughness = .46;
        material.clearcoat = 0;
      }
      if (fan) {
        material.color.set("#9ba9b5");
        material.metalness = 1;
        material.roughness = .34;
        material.clearcoat = 0;
      }
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace("#include <common>",
          "#include <common>\nattribute float _occlusion;\nvarying float vOcclusion;\nvarying vec3 vSurfacePosition;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOcclusion = _occlusion;\nvSurfacePosition = position;");
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
          "#include <common>\nvarying float vOcclusion;\nvarying vec3 vSurfacePosition;")
          .replace("#include <aomap_fragment>", `#include <aomap_fragment>
            float cavity = ${fan ? "mix(.48, 1.0, vOcclusion)" : "vOcclusion"};
            reflectedLight.indirectDiffuse *= cavity;
            #if defined(USE_ENVMAP)
              reflectedLight.indirectSpecular *= computeSpecularOcclusion(saturate(dot(geometryNormal, geometryViewDir)), cavity, material.roughness);
            #endif
            #if defined(USE_CLEARCOAT)
              clearcoatSpecularIndirect *= computeSpecularOcclusion(saturate(dot(geometryClearcoatNormal, geometryViewDir)), cavity, material.clearcoatRoughness);
            #endif
          `);
        if (painted || source.name.includes("aluminium")) {
          shader.fragmentShader = shader.fragmentShader
            .replace("void main() {", surfaceDetail + "\nvoid main() {")
            .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
              float finishVariation = finishNoise(vSurfacePosition * vec3(1.6, 3.0, 3.0)) - .5;
              roughnessFactor += finishVariation * .035;
              float finishHeight = finishNoise(vSurfacePosition * 2.4) * .00065;
            `)
            .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = finishNormal(normal, finishHeight);")
            .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>
              #ifdef USE_CLEARCOAT
                clearcoatNormal = finishNormal(clearcoatNormal, finishHeight);
              #endif
            `)
            .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
              #ifdef USE_CLEARCOAT
                material.clearcoatRoughness = clamp(material.clearcoatRoughness + finishVariation * .025, .08, 1.0);
              #endif
            `);
        }
        if (fanCenter) {
          shader.uniforms.fanCenter = { value: fanCenter };
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 fanCenter;")
            .replace("#include <color_fragment>", `#include <color_fragment>
              vec2 hub = vSurfacePosition.yz - fanCenter.yz;
              float radius = length(hub);
              float spiral = sin(atan(hub.y, hub.x) - radius * 11.0);
              float paint = smoothstep(.65, .9, spiral) * (1.0 - smoothstep(.3, .43, radius));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .89, .9), paint);
            `)
            .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - paint;");
        }
        if (intake !== null) {
          shader.uniforms.intakeFront = { value: intake };
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform float intakeFront;")
            .replace("#include <color_fragment>", `#include <color_fragment>
              float intakeLip = smoothstep(intakeFront - .26, intakeFront - .12, vSurfacePosition.x);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.68, .71, .75), intakeLip);
            `)
            .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, intakeLip);")
            .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
              material.roughness = mix(material.roughness, .19, intakeLip);
              #ifdef USE_CLEARCOAT
                material.clearcoat *= 1.0 - intakeLip;
              #endif
            `);
        }
      };
      material.customProgramCacheKey = () => `cad-finish-v4:${nacelle}:${fan}:${painted}:${source.name.includes("aluminium")}`;
      replacements.set(key, material);
      originals.add(source);
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(finish) : finish(object.material);
  });
  originals.forEach(source => source.dispose());
}

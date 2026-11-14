import { CanvasTexture, Group, Mesh, MeshBasicMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from "three";

export function createAircraftLights(model: Group) {
  const group = new Group();
  group.name = "navigation-lights";
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = textureCanvas.height = 64;
  const context = textureCanvas.getContext("2d")!;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(.14, "rgba(255,255,255,.7)");
  glow.addColorStop(.4, "rgba(255,255,255,.18)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(textureCanvas);
  const geometry = new SphereGeometry(.075, 12, 8);
  const materials: (MeshBasicMaterial | SpriteMaterial)[] = [];
  function lamp(position: Vector3, color: number, size: number) {
    const material = new MeshBasicMaterial({ color, toneMapped: false });
    const bulb = new Mesh(geometry, material);
    bulb.position.copy(position);
    const haloMaterial = new SpriteMaterial({ map: texture, color, opacity: .72, depthWrite: false, toneMapped: false });
    const halo = new Sprite(haloMaterial);
    halo.scale.setScalar(size);
    halo.position.copy(position);
    group.add(bulb, halo);
    materials.push(material, haloMaterial);
    return { bulb, halo };
  }

  const port = new Vector3(), starboard = new Vector3(), spine = new Vector3();
  model.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      if (z < port.z) port.set(x, y, z);
      if (z > starboard.z) starboard.set(x, y, z);
      if (x > 3 && x < 5 && Math.abs(z) < .3 && y > spine.y) spine.set(x, y, z);
    }
  });
  port.y += .09;
  starboard.y += .09;
  spine.y += .08;
  lamp(port, 0xff493a, 1.05);
  lamp(starboard, 0x4fffb1, 1.05);
  const beacon = lamp(spine, 0xff492a, 1.6);
  return {
    group,
    update(seconds: number) {
      const sweep = Math.pow((Math.cos(seconds * Math.PI * 2 / 1.8) + 1) / 2, 10);
      beacon.halo.material.opacity = .04 + sweep * .8;
      beacon.bulb.material.color.setRGB(.35 + .65 * sweep, .025 + .16 * sweep, .012);
    },
    dispose() {
      texture.dispose();
      geometry.dispose();
      materials.forEach(material => material.dispose());
    },
  };
}

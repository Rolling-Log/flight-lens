import { Group, Mesh, Vector3 } from "three";

export function createAircraftFans(model: Group) {
  const meshes: Mesh[] = [];
  model.traverse(object => {
    if (object instanceof Mesh && [4, 11, 14, 15].includes(object.userData.cad_body)) meshes.push(object);
  });
  return meshes.map(mesh => {
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox!.getCenter(new Vector3());
    const pivot = new Group();
    pivot.name = "engine-fan";
    pivot.position.copy(mesh.position).add(center);
    mesh.parent!.add(pivot);
    mesh.position.sub(center);
    pivot.add(mesh);
    return pivot;
  });
}

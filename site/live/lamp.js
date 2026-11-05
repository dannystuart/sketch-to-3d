// A desk lamp built from three.js shapes: round base, two arms, a cone shade
export default function lamp(THREE) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({color: 0x2f6fb5, metalness: 0.2, roughness: 0.5, name: 'paint'});
  const steel = new THREE.MeshStandardMaterial({color: 0xb8b8b8, metalness: 0.9, roughness: 0.3, name: 'steel'});
  const bulb = new THREE.MeshStandardMaterial({color: 0xfff3c4, emissive: 0x332a00, name: 'bulb'});
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 48), metal);
  base.position.y = 0.06;
  g.add(base);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 32), steel);
  knob.position.set(0.3, 0.15, 0.2);
  g.add(knob);
  const arm = (len, x0, y0, ang) => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.06), metal);
    a.position.set(x0 + Math.sin(ang) * len / 2, y0 + Math.cos(ang) * len / 2, 0);
    a.rotation.z = -ang;
    g.add(a);
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 32), steel);
    j.rotation.x = Math.PI / 2;
    j.position.set(x0, y0, 0);
    g.add(j);
    return [x0 + Math.sin(ang) * len, y0 + Math.cos(ang) * len];
  };
  const [x1, y1] = arm(1.1, 0, 0.12, 0.35);
  const [x2, y2] = arm(0.9, x1, y1, -1.1);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.45, 48, 1, true), metal);
  shade.position.set(x2 - 0.15, y2 - 0.12, 0);
  shade.rotation.z = -0.6;
  g.add(shade);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 16), bulb);
  b.position.set(x2 - 0.22, y2 - 0.22, 0);
  g.add(b);
  return g;
}

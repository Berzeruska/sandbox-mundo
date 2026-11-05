import * as THREE from 'three';
import { eyeOf, INSTANCE_FLOATS, REGION, type Instances, type Mesh, type Scene, type View } from './scene';

/** O mesmo diorama em Three.js: mesmos dados, mesma luz, mesma sombra cozida uma vez. */
THREE.ColorManagement.enabled = false;

function geometry(m: Mesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const i = new THREE.InterleavedBuffer(m.data, 10);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(i, 3, 0));
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(i, 3, 3));
  g.setAttribute('color', new THREE.InterleavedBufferAttribute(i, 3, 6));
  g.setAttribute('aLeg', new THREE.InterleavedBufferAttribute(i, 1, 9));
  return g;
}

export class ThreeRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene3 = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 1, 800);
  private body: THREE.InstancedMesh;
  private blob: THREE.InstancedMesh;
  private time = { value: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(canvas: HTMLCanvasElement, private scene: Scene) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    const st = scene.style;
    this.scene3.background = new THREE.Color(...st.background);
    const hemi = new THREE.HemisphereLight(new THREE.Color(...st.sky), new THREE.Color(...st.ground), Math.PI);
    const sun = new THREE.DirectionalLight(new THREE.Color(...st.sunColor), Math.PI);
    const c = REGION / 2;
    sun.position.set(c + st.sun[0] * 120, st.sun[1] * 120, c + st.sun[2] * 120);
    sun.target.position.set(c, 0, c);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const r = REGION * 0.78;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 260 });
    sun.shadow.bias = -0.0015;
    this.scene3.add(hemi, sun, sun.target);
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const add = (m: Mesh) => {
      const mesh = new THREE.Mesh(geometry(m), lit);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene3.add(mesh);
    };
    add(scene.terrain);
    add(scene.water);
    for (const p of scene.parts) this.scene3.add(this.instanced(p, lit));
    const walking = new THREE.MeshLambertMaterial({ vertexColors: true });
    walking.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = this.time;
      shader.vertexShader = `attribute float aLeg; attribute float iPhase; uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n if (aLeg != 0.0) transformed.z += aLeg * sin(uTime * 9.0 + iPhase) * 0.32 * (0.36 - position.y) / 0.36;',
      );
    };
    this.body = this.instanced(scene.figures.body, walking);
    const phases = new Float32Array(scene.figures.count);
    for (let k = 0; k < phases.length; k++) phases[k] = scene.figures.body.data[k * INSTANCE_FLOATS + 7] as number;
    this.body.geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.blob = this.instanced(scene.figures.blob, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blob.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.castShadow = false;
    this.blob.castShadow = false;
    this.blob.receiveShadow = false;
    this.scene3.add(this.body, this.blob);
  }

  private instanced(p: Instances, material: THREE.Material): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry(p.mesh), material, p.count);
    const color = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      this.setMatrix(mesh, p.data, k);
      const o = k * INSTANCE_FLOATS;
      mesh.setColorAt(k, color.setRGB(p.data[o + 8] as number, p.data[o + 9] as number, p.data[o + 10] as number));
    }
    mesh.castShadow = p.casts;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private setMatrix(mesh: THREE.InstancedMesh, d: Float32Array, k: number): void {
    const o = k * INSTANCE_FLOATS;
    this.p.set(d[o] as number, d[o + 1] as number, d[o + 2] as number);
    this.s.set(d[o + 3] as number, d[o + 4] as number, d[o + 5] as number);
    this.q.setFromAxisAngle(this.up, d[o + 6] as number);
    mesh.setMatrixAt(k, this.m.compose(this.p, this.q, this.s));
  }

  updateFigures(): void {
    const f = this.scene.figures;
    for (let k = 0; k < f.count; k++) {
      this.setMatrix(this.body, f.body.data, k);
      this.setMatrix(this.blob, f.blob.data, k);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.blob.instanceMatrix.needsUpdate = true;
  }

  draw(v: View, aspect: number, time: number): void {
    this.time.value = time;
    this.camera.fov = v.fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const e = eyeOf(v);
    this.camera.position.set(e[0], e[1], e[2]);
    this.camera.lookAt(v.x, 0, v.z);
    this.renderer.render(this.scene3, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
}

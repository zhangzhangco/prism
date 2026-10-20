import type * as ThreeNS from "three";
import type { StageDocument, StageObject, StageObjectKind, StageVector } from "@prism/contracts";

/**
 * Building blocks for the 3D stage.
 *
 * The stage uses simple parametric shapes rather than imported models: they
 * need no assets, they are obvious to place, and they make it easy to judge
 * a composition — which is what a staging area is for.
 *
 * The three module is passed in rather than imported, so the library only
 * ends up in the chunk that actually needs it.
 */

export type ThreeModule = typeof ThreeNS;

export interface StageScene {
  THREE: ThreeModule;
  scene: ThreeNS.Scene;
  camera: ThreeNS.PerspectiveCamera;
  /** The camera the operator is looking through, which is not the shot camera. */
  editorCamera: ThreeNS.PerspectiveCamera;
  renderer: ThreeNS.WebGLRenderer;
  /** Meshes keyed by object id, so transforms can be applied. */
  meshes: Map<string, ThreeNS.Object3D>;
  /** Objects that are rebuilt when the settings change. */
  stage: ThreeNS.Group;
  dispose: () => void;
  resize: (width: number, height: number) => void;
  render: (view: "editor" | "shot") => void;
  exportFrame: (width: number, height: number) => string;
  applySettings: (settings: StageDocument["settings"]) => void;
  applyTransform: (object: StageObject, mesh: ThreeNS.Object3D) => void;
  rebuildObjects: () => void;
}


function geometryFor(
  THREE: ThreeModule,
  kind: StageObjectKind,
  height: number,
): ThreeNS.BufferGeometry {
  switch (kind) {
    case "sphere":
      return new THREE.SphereGeometry(height / 2, 32, 24);
    case "cylinder":
      return new THREE.CylinderGeometry(height / 3, height / 3, height, 28);
    case "cone":
      return new THREE.ConeGeometry(height / 2.4, height, 28);
    case "box":
    default:
      return new THREE.BoxGeometry(height / 1.6, height, height / 1.6);
  }
}

/**
 * A rough human figure.
 *
 * It is assembled from primitives — torso, head, arms and legs — which
 * reads clearly as a person at a glance and needs no model file.
 */
function buildFigure(
  THREE: ThreeModule,
  height: number,
  color: string,
): ThreeNS.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02 });

  const unit = height / 8;
  const add = (geometry: ThreeNS.BufferGeometry, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Legs
  add(new THREE.CylinderGeometry(unit * 0.42, unit * 0.36, unit * 3.2, 14), -unit * 0.5, unit * 1.6, 0);
  add(new THREE.CylinderGeometry(unit * 0.42, unit * 0.36, unit * 3.2, 14), unit * 0.5, unit * 1.6, 0);
  // Torso
  add(new THREE.CapsuleGeometry(unit * 0.85, unit * 2.1, 6, 16), 0, unit * 4.5, 0);
  // Arms
  add(new THREE.CapsuleGeometry(unit * 0.3, unit * 2.2, 4, 12), -unit * 1.25, unit * 4.4, 0);
  add(new THREE.CapsuleGeometry(unit * 0.3, unit * 2.2, 4, 12), unit * 1.25, unit * 4.4, 0);
  // Head
  add(new THREE.SphereGeometry(unit * 0.85, 20, 16), 0, unit * 6.6, 0);

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

export function createStageScene(
  THREE: ThreeModule,
  container: HTMLElement,
  document: StageDocument,
): StageScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f0f2f5");

  const editorCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  editorCamera.position.set(5, 4, 7);
  editorCamera.lookAt(0, 1, 0);

  const shotCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.6);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(6, 10, 4);
  key.castShadow = true;
  // The shadow camera has to cover the whole stage. With the default frustum
  // everything outside it renders as if it were in shadow, which turns the
  // ground black.
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // A second, softer light from the other side keeps the shadowed side of a
  // figure readable.
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.9);
  fill.position.set(-7, 6, -5);
  scene.add(fill);

  const stage = new THREE.Group();
  scene.add(stage);

  const meshes = new Map<string, ThreeNS.Object3D>();
  const disposables: ThreeNS.BufferGeometry[] = [];
  const materials: ThreeNS.Material[] = [];

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  stage.add(ground);
  disposables.push(ground.geometry);
  materials.push(ground.material as ThreeNS.Material);

  const grid = new THREE.GridHelper(40, 40, 0xc2c8d0, 0xdde1e6);
  stage.add(grid);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 20),
    new THREE.MeshStandardMaterial({ color: 0xe9ecf0, roughness: 1, side: THREE.DoubleSide }),
  );
  backdrop.position.set(0, 10, -12);
  backdrop.receiveShadow = true;
  stage.add(backdrop);
  disposables.push(backdrop.geometry);
  materials.push(backdrop.material as ThreeNS.Material);

  function buildObject(object: StageObject): ThreeNS.Object3D {
    const colour = new THREE.Color(object.color);
    if (object.kind === "figure") {
      const group = buildFigure(THREE, object.height, colour.getStyle());
      group.userData.disposable = true;
      return group;
    }
    const geometry = geometryFor(THREE, object.kind, object.height);
    disposables.push(geometry);
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.65 });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function rebuildObjects(): void {
    for (const child of [...stage.children]) {
      if (child === ground || child === grid || child === backdrop) continue;
      stage.remove(child);
    }
    meshes.clear();

    for (const object of document.objects) {
      const mesh = buildObject(object);
      meshes.set(object.id, mesh);
      stage.add(mesh);
      applyTransform(object, mesh);
    }
  }

  function applyTransform(object: StageObject, mesh: ThreeNS.Object3D): void {
    mesh.position.set(object.position.x, object.position.y, object.position.z);
    mesh.rotation.set(
      (object.rotation.x * Math.PI) / 180,
      (object.rotation.y * Math.PI) / 180,
      (object.rotation.z * Math.PI) / 180,
    );
    mesh.scale.set(object.scale.x, object.scale.y, object.scale.z);
  }

  function applySettings(settings: StageDocument["settings"]): void {
    ground.visible = settings.ground;
    grid.visible = settings.grid;
    backdrop.visible = settings.backdrop;
    key.intensity = 2.2 * settings.light;
    fill.intensity = 0.9 * settings.light;
    ambient.intensity = 1.6 * settings.light;
  }

  function activeCamera(): ThreeNS.PerspectiveCamera {
    const camera = document.cameras.find((item) => item.id === document.activeCameraId);
    if (!camera) return shotCamera;
    shotCamera.position.set(camera.position.x, camera.position.y, camera.position.z);
    shotCamera.lookAt(camera.target.x, camera.target.y, camera.target.z);
    shotCamera.fov = camera.fov;
    shotCamera.updateProjectionMatrix();
    return shotCamera;
  }

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    editorCamera.aspect = width / height;
    editorCamera.updateProjectionMatrix();
    shotCamera.aspect = width / height;
    shotCamera.updateProjectionMatrix();
  }

  function render(view: "editor" | "shot"): void {
    const camera = view === "shot" ? activeCamera() : editorCamera;
    renderer.render(scene, camera);
  }

  /**
   * Render the active camera's view at a given size.
   *
   * The renderer is resized for the capture and put back afterwards, so the
   * editor keeps its own dimensions.
   */
  function exportFrame(width: number, height: number): string {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const camera = activeCamera();

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const data = renderer.domElement.toDataURL("image/png");

    renderer.setSize(size.x, size.y, false);
    editorCamera.aspect = size.x / size.y;
    editorCamera.updateProjectionMatrix();
    camera.aspect = size.x / size.y;
    camera.updateProjectionMatrix();
    renderer.render(scene, editorCamera);

    return data;
  }

  function dispose(): void {
    for (const geometry of disposables) geometry.dispose();
    for (const material of materials) material.dispose();
    grid.geometry.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  rebuildObjects();
  applySettings(document.settings);

  return {
    THREE,
    scene,
    camera: shotCamera,
    editorCamera,
    renderer,
    meshes,
    stage,
    dispose,
    exportFrame,
    applySettings,
    applyTransform,
    rebuildObjects,
    render,
    resize,
  };
}

export function applyObjectTransform(
  scene: StageScene,
  object: StageObject,
): void {
  const mesh = scene.meshes.get(object.id);
  if (!mesh) return;
  mesh.position.set(object.position.x, object.position.y, object.position.z);
  mesh.rotation.set(
    (object.rotation.x * Math.PI) / 180,
    (object.rotation.y * Math.PI) / 180,
    (object.rotation.z * Math.PI) / 180,
  );
  mesh.scale.set(object.scale.x, object.scale.y, object.scale.z);
}

export function vector(value: Partial<StageVector> | undefined, fallback: StageVector): StageVector {
  return {
    x: typeof value?.x === "number" ? value.x : fallback.x,
    y: typeof value?.y === "number" ? value.y : fallback.y,
    z: typeof value?.z === "number" ? value.z : fallback.z,
  };
}

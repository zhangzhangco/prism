<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { StageCamera, StageDocument, StageObject, StageObjectKind } from "@prism/contracts";
import { api } from "@/api/client";
import { useCanvasStore } from "@/stores/canvas";
import { createOrbit, type OrbitHandle } from "@/stage/orbit";
import { createStageScene, type StageScene } from "@/stage/scene";
import { defaultStage } from "@/stage/defaults";

const props = defineProps<{ nodeId: string }>();
const canvasStore = useCanvasStore();

const container = ref<HTMLDivElement | null>(null);
const scene = shallowRef<StageScene | null>(null);
const orbit = shallowRef<OrbitHandle | null>(null);
const ready = ref(false);
const loadError = ref<string | null>(null);
const exporting = ref(false);
const exportMessage = ref<string | null>(null);
const showShotCamera = ref(false);

const document_ = computed<StageDocument>(() => {
  const value = (canvasStore.flowNodes.find((node) => node.id === props.nodeId)?.data ?? {}) as {
    stage?: StageDocument;
  };
  return value.stage ?? defaultStage();
});

const selectedObjectId = ref<string | null>(null);
const selectedCameraId = ref<string | null>(null);

const selectedObject = computed(() =>
  document_.value.objects.find((object) => object.id === selectedObjectId.value) ?? null,
);
const selectedCamera = computed(() =>
  document_.value.cameras.find((camera) => camera.id === selectedCameraId.value) ?? null,
);

let frameHandle = 0;

function commit(next: StageDocument): void {
  canvasStore.updateNodeData(props.nodeId, { stage: next });
}

function replaceObject(object: StageObject): void {
  commit({
    ...document_.value,
    objects: document_.value.objects.map((item) => (item.id === object.id ? object : item)),
  });
}

function replaceCamera(camera: StageCamera): void {
  commit({
    ...document_.value,
    cameras: document_.value.cameras.map((item) => (item.id === camera.id ? camera : item)),
  });
}

function addObject(kind: StageObjectKind): void {
  const index = document_.value.objects.length + 1;
  const object: StageObject = {
    id: `object-${Date.now().toString(36)}-${index}`,
    name: `${kind === "figure" ? "Actor" : "Object"} ${index}`,
    kind,
    position: { x: (index - 1) * 1.4 - 1.4, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: kind === "figure" ? "#4c6ef5" : "#868e96",
    height: kind === "figure" ? 1.75 : 1,
  };
  commit({ ...document_.value, objects: [...document_.value.objects, object] });
  selectedObjectId.value = object.id;
  scene.value?.rebuildObjects();
}

function removeObject(id: string): void {
  commit({
    ...document_.value,
    objects: document_.value.objects.filter((object) => object.id !== id),
  });
  if (selectedObjectId.value === id) selectedObjectId.value = null;
  scene.value?.rebuildObjects();
}

function addCamera(): void {
  const index = document_.value.cameras.length + 1;
  const camera: StageCamera = {
    id: `camera-${Date.now().toString(36)}-${index}`,
    name: `Camera ${index}`,
    position: { x: 0, y: 1.6, z: 5.5 },
    target: { x: 0, y: 1.1, z: 0 },
    fov: 45,
  };
  commit({ ...document_.value, cameras: [...document_.value.cameras, camera] });
  selectedCameraId.value = camera.id;
}

function removeCamera(id: string): void {
  const cameras = document_.value.cameras.filter((camera) => camera.id !== id);
  commit({
    ...document_.value,
    cameras,
    activeCameraId: document_.value.activeCameraId === id ? (cameras[0]?.id ?? "") : document_.value.activeCameraId,
  });
  if (selectedCameraId.value === id) selectedCameraId.value = null;
}

function setActiveCamera(id: string): void {
  commit({ ...document_.value, activeCameraId: id });
}

function updateNumber(
  target: StageObject | StageCamera | null,
  key: "x" | "y" | "z",
  value: number,
  axis: "position" | "rotation" | "target",
): void {
  if (!target) return;
  if (axis === "position" && "position" in target) {
    replaceObject({ ...(target as StageObject), position: { ...target.position, [key]: value } });
  } else if (axis === "rotation" && "rotation" in target) {
    replaceObject({ ...(target as StageObject), rotation: { ...target.rotation, [key]: value } });
  } else if (axis === "target" && "target" in target) {
    replaceCamera({ ...(target as StageCamera), target: { ...target.target, [key]: value } });
  }
}

function updateScale(axis: "x" | "y" | "z", value: number): void {
  const object = selectedObject.value;
  if (!object) return;
  replaceObject({ ...object, scale: { ...object.scale, [axis]: value } });
}

function updateHeight(value: number): void {
  const object = selectedObject.value;
  if (!object) return;
  replaceObject({ ...object, height: value });
}

function updateColour(value: string): void {
  const object = selectedObject.value;
  if (!object) return;
  replaceObject({ ...object, color: value });
}

function updateFov(value: number): void {
  const camera = selectedCamera.value;
  if (!camera) return;
  replaceCamera({ ...camera, fov: value });
}

function toggleSetting(key: "ground" | "grid" | "backdrop"): void {
  const settings = { ...document_.value.settings, [key]: !document_.value.settings[key] };
  commit({ ...document_.value, settings });
  scene.value?.applySettings(settings);
}

function setLight(value: number): void {
  const settings = { ...document_.value.settings, light: value };
  commit({ ...document_.value, settings });
  scene.value?.applySettings(settings);
}

/** Render the active camera's view and hand it to the canvas as an asset. */
async function exportFrame(): Promise<void> {
  const current = scene.value;
  const canvasId = canvasStore.currentId;
  if (!current || !canvasId) return;

  exporting.value = true;
  exportMessage.value = null;
  try {
    const data = current.exportFrame(1280, 720);
    const response = await fetch(data);
    const blob = await response.blob();
    const file = new File([blob], "stage-frame.png", { type: "image/png" });
    const asset = await api.uploadAsset(canvasId, file);
    canvasStore.updateNodeData(props.nodeId, { frame: asset });
    exportMessage.value = "Frame exported. It is now available on the node's output.";
  } catch (cause) {
    exportMessage.value = cause instanceof Error ? cause.message : "The frame could not be exported";
  } finally {
    exporting.value = false;
  }
}

function tick(): void {
  const current = scene.value;
  if (!current) return;
  current.render(showShotCamera.value ? "shot" : "editor");
  frameHandle = requestAnimationFrame(tick);
}

onMounted(async () => {
  try {
    const THREE = await import("three");
    if (!container.value) return;
    const built = createStageScene(THREE, container.value, document_.value);
    scene.value = built;

    if (import.meta.env.DEV) {
      // A handle for poking at the scene from the console while developing.
      (window as unknown as { __prismStage?: unknown }).__prismStage = built;
    }

    const handle = createOrbit({
      THREE,
      camera: built.editorCamera,
      element: built.renderer.domElement,
    });
    orbit.value = handle;

    const observer = new ResizeObserver(() => {
      const element = container.value;
      if (element) built.resize(element.clientWidth, element.clientHeight);
    });
    observer.observe(container.value);
    built.resize(container.value.clientWidth, container.value.clientHeight);

    frameHandle = requestAnimationFrame(tick);
    ready.value = true;
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : "The 3D view could not be started";
  }
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frameHandle);
  orbit.value?.dispose();
  scene.value?.dispose();
  scene.value = null;
});

// Keep the meshes in step with the stored transforms.
watch(
  () => document_.value.objects,
  () => {
    const current = scene.value;
    if (!current) return;
    current.rebuildObjects();
  },
  { deep: true },
);

watch(
  () => document_.value.activeCameraId,
  () => {
    selectedCameraId.value = document_.value.activeCameraId;
  },
  { immediate: true },
);
</script>

<template>
  <div class="console">
    <header class="console__bar">
      <h2>Director's console</h2>
      <div class="console__bar-actions">
        <label class="console__toggle">
          <input type="checkbox" v-model="showShotCamera" />
          Shot camera
        </label>
        <button :disabled="exporting" @click="exportFrame">
          {{ exporting ? "Exporting…" : "Export frame" }}
        </button>
        <button class="ghost" @click="$emit('close')">Close</button>
      </div>
    </header>

    <p v-if="loadError" class="console__error">{{ loadError }}</p>

    <div class="console__body">
      <aside class="console__panel">
        <h3>Objects</h3>
        <ul class="console__list">
          <li
            v-for="object in document_.objects"
            :key="object.id"
            :class="{ 'is-active': object.id === selectedObjectId }"
          >
            <button class="console__list-item" @click="selectedObjectId = object.id">
              {{ object.name }}
            </button>
            <button class="console__list-remove" title="Remove" @click="removeObject(object.id)">
              ×
            </button>
          </li>
        </ul>
        <div class="console__add">
          <button @click="addObject('figure')">Actor</button>
          <button @click="addObject('box')">Box</button>
          <button @click="addObject('sphere')">Sphere</button>
          <button @click="addObject('cylinder')">Cylinder</button>
          <button @click="addObject('cone')">Cone</button>
        </div>

        <h3>Cameras</h3>
        <ul class="console__list">
          <li
            v-for="camera in document_.cameras"
            :key="camera.id"
            :class="{ 'is-active': camera.id === document_.activeCameraId }"
          >
            <button
              class="console__list-item"
              @click="selectedCameraId = camera.id; setActiveCamera(camera.id)"
            >
              {{ camera.name }}
            </button>
            <button class="console__list-remove" title="Remove" @click="removeCamera(camera.id)">
              ×
            </button>
          </li>
        </ul>
        <button @click="addCamera">Add camera</button>

        <h3>Stage</h3>
        <label class="console__check"
          ><input type="checkbox" :checked="document_.settings.ground" @change="toggleSetting('ground')" />Ground</label
        >
        <label class="console__check"
          ><input type="checkbox" :checked="document_.settings.grid" @change="toggleSetting('grid')" />Grid</label
        >
        <label class="console__check"
          ><input
            type="checkbox"
            :checked="document_.settings.backdrop"
            @change="toggleSetting('backdrop')"
          />Backdrop</label
        >
        <label class="console__slider">
          Light
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            :value="document_.settings.light"
            @input="setLight(Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </aside>

      <div ref="container" class="console__viewport"></div>

      <aside class="console__panel console__panel--right">
        <template v-if="selectedObject">
          <h3>{{ selectedObject.name }}</h3>
          <label class="console__field">
            <span>Position</span>
            <div class="console__triple">
              <input
                type="number"
                step="0.1"
                :value="selectedObject.position.x"
                @input="updateNumber(selectedObject, 'x', Number(($event.target as HTMLInputElement).value), 'position')"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedObject.position.y"
                @input="updateNumber(selectedObject, 'y', Number(($event.target as HTMLInputElement).value), 'position')"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedObject.position.z"
                @input="updateNumber(selectedObject, 'z', Number(($event.target as HTMLInputElement).value), 'position')"
              />
            </div>
          </label>
          <label class="console__field">
            <span>Rotation</span>
            <div class="console__triple">
              <input
                type="number"
                step="5"
                :value="selectedObject.rotation.x"
                @input="updateNumber(selectedObject, 'x', Number(($event.target as HTMLInputElement).value), 'rotation')"
              />
              <input
                type="number"
                step="5"
                :value="selectedObject.rotation.y"
                @input="updateNumber(selectedObject, 'y', Number(($event.target as HTMLInputElement).value), 'rotation')"
              />
              <input
                type="number"
                step="5"
                :value="selectedObject.rotation.z"
                @input="updateNumber(selectedObject, 'z', Number(($event.target as HTMLInputElement).value), 'rotation')"
              />
            </div>
          </label>
          <label class="console__field">
            <span>Scale</span>
            <div class="console__triple">
              <input
                type="number"
                step="0.1"
                :value="selectedObject.scale.x"
                @input="updateScale('x', Number(($event.target as HTMLInputElement).value))"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedObject.scale.y"
                @input="updateScale('y', Number(($event.target as HTMLInputElement).value))"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedObject.scale.z"
                @input="updateScale('z', Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </label>
          <label class="console__field">
            <span>Height</span>
            <input
              type="number"
              step="0.05"
              :value="selectedObject.height"
              @input="updateHeight(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="console__field">
            <span>Colour</span>
            <input type="color" :value="selectedObject.color" @input="updateColour(($event.target as HTMLInputElement).value)" />
          </label>
        </template>

        <template v-if="selectedCamera">
          <h3>{{ selectedCamera.name }}</h3>
          <label class="console__field">
            <span>Position</span>
            <div class="console__triple">
              <input
                type="number"
                step="0.1"
                :value="selectedCamera.position.x"
                @input="updateNumber(selectedCamera, 'x', Number(($event.target as HTMLInputElement).value), 'position')"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedCamera.position.y"
                @input="updateNumber(selectedCamera, 'y', Number(($event.target as HTMLInputElement).value), 'position')"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedCamera.position.z"
                @input="updateNumber(selectedCamera, 'z', Number(($event.target as HTMLInputElement).value), 'position')"
              />
            </div>
          </label>
          <label class="console__field">
            <span>Look at</span>
            <div class="console__triple">
              <input
                type="number"
                step="0.1"
                :value="selectedCamera.target.x"
                @input="updateNumber(selectedCamera, 'x', Number(($event.target as HTMLInputElement).value), 'target')"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedCamera.target.y"
                @input="updateNumber(selectedCamera, 'y', Number(($event.target as HTMLInputElement).value), 'target')"
              />
              <input
                type="number"
                step="0.1"
                :value="selectedCamera.target.z"
                @input="updateNumber(selectedCamera, 'z', Number(($event.target as HTMLInputElement).value), 'target')"
              />
            </div>
          </label>
          <label class="console__field">
            <span>Field of view</span>
            <input
              type="number"
              min="10"
              max="120"
              step="1"
              :value="selectedCamera.fov"
              @input="updateFov(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </template>

        <p v-if="!selectedObject && !selectedCamera" class="console__hint">
          Select an object or a camera to edit it.
        </p>
        <p v-if="exportMessage" class="console__message">{{ exportMessage }}</p>
      </aside>
    </div>
  </div>
</template>

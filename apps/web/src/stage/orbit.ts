import type * as ThreeNS from "three";

/**
 * A small orbit controller.
 *
 * Writing it here rather than pulling in an addon keeps the dependency
 * surface small and lets the behaviour match what the editor needs: drag to
 * orbit, wheel to dolly, and a modifier to pan.
 *
 * The three module is passed in rather than imported, so the library only
 * ends up in the chunk that actually needs it.
 */

export interface OrbitOptions {
  THREE: typeof ThreeNS;
  camera: ThreeNS.PerspectiveCamera;
  element: HTMLElement;
  target?: ThreeNS.Vector3;
  minDistance?: number;
  maxDistance?: number;
}

export interface OrbitHandle {
  dispose: () => void;
  update: () => void;
}

export function createOrbit(options: OrbitOptions): OrbitHandle {
  const { THREE, camera, element } = options;
  const target = options.target ?? new THREE.Vector3(0, 1, 0);
  const minDistance = options.minDistance ?? 1.5;
  const maxDistance = options.maxDistance ?? 120;

  let dragging = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  function sync(): void {
    offset.copy(camera.position).sub(target);
    spherical.setFromVector3(offset);
  }

  function apply(): void {
    spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
    spherical.radius = Math.max(minDistance, Math.min(maxDistance, spherical.radius));
    offset.setFromSpherical(spherical);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  }

  function onPointerDown(event: PointerEvent): void {
    dragging = true;
    panning = event.shiftKey || event.button === 2;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (panning) {
      const distance = camera.position.distanceTo(target);
      const scale = (distance * Math.PI * 2) / element.clientHeight;
      right.setFromMatrixColumn(camera.matrix, 0);
      up.setFromMatrixColumn(camera.matrix, 1);
      target.addScaledVector(right, -dx * scale);
      target.addScaledVector(up, dy * scale);
    } else {
      spherical.theta -= dx * 0.005;
      spherical.phi -= dy * 0.005;
    }
    apply();
  }

  function onPointerUp(event: PointerEvent): void {
    dragging = false;
    panning = false;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    sync();
    const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
    spherical.radius *= factor;
    apply();
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("contextmenu", onContextMenu);

  sync();
  apply();

  return {
    dispose: () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenu);
    },
    update: apply,
  };
}

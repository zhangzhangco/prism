import type { StageDocument } from "@prism/contracts";

/**
 * The starting point for a new stage.
 *
 * It lives in its own module so the canvas store can use it without pulling
 * in the renderer.
 */
export function defaultStage(): StageDocument {
  return {
    objects: [
      {
        id: "object-1",
        name: "Actor 1",
        kind: "figure",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        color: "#4c6ef5",
        height: 1.75,
      },
    ],
    cameras: [
      {
        id: "camera-1",
        name: "Camera 1",
        position: { x: 0, y: 1.6, z: 5.5 },
        target: { x: 0, y: 1.1, z: 0 },
        fov: 45,
      },
    ],
    activeCameraId: "camera-1",
    settings: { ground: true, grid: true, backdrop: true, light: 1 },
  };
}

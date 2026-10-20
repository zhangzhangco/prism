import { encodePng } from "./png.js";
import type { DecodedImage } from "./png-decode.js";

/**
 * Image resampling.
 *
 * The upscale plugin resamples the source image in process, so the result is
 * a real enlargement of the input rather than a generic placeholder. Lanczos
 * is used because it keeps edges crisp without the ringing that a bicubic
 * kernel produces on hard contrasts.
 */

const LANCZOS_SUPPORT = 3;

function lanczos(x: number): number {
  if (x === 0) return 1;
  const distance = Math.abs(x);
  if (distance >= LANCZOS_SUPPORT) return 0;
  const px = Math.PI * x;
  return (Math.sin(px) / px) * (Math.sin(px / LANCZOS_SUPPORT) / (px / LANCZOS_SUPPORT));
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Resample an image to a new size.
 *
 * The two axes are scaled independently, so a source can be enlarged to any
 * ratio rather than only a uniform one.
 */
export function resample(image: DecodedImage, width: number, height: number): DecodedImage {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const out = Buffer.alloc(targetWidth * targetHeight * 4);

  const scaleX = image.width / targetWidth;
  const scaleY = image.height / targetHeight;
  // When downscaling, widen the kernel so every source pixel contributes.
  const supportX = Math.max(LANCZOS_SUPPORT / Math.max(scaleX, 1), LANCZOS_SUPPORT);
  const supportY = Math.max(LANCZOS_SUPPORT / Math.max(scaleY, 1), LANCZOS_SUPPORT);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const firstY = Math.floor(sourceY - supportY + 1);
    const lastY = Math.ceil(sourceY + supportY);

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const firstX = Math.floor(sourceX - supportX + 1);
      const lastX = Math.ceil(sourceX + supportX);

      let weightSum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sy = firstY; sy <= lastY; sy += 1) {
        const weightY = lanczos((sy - sourceY) / Math.max(scaleY, 1));
        if (weightY === 0) continue;
        const clampedY = clamp(sy, 0, image.height - 1);

        for (let sx = firstX; sx <= lastX; sx += 1) {
          const weightX = lanczos((sx - sourceX) / Math.max(scaleX, 1));
          if (weightX === 0) continue;
          const clampedX = clamp(sx, 0, image.width - 1);

          const weight = weightX * weightY;
          const index = (clampedY * image.width + clampedX) * 4;
          const sourceAlpha = image.data[index + 3] ?? 255;

          // Weight colour by alpha so transparent pixels do not bleed in.
          red += (image.data[index] ?? 0) * weight * (sourceAlpha / 255);
          green += (image.data[index + 1] ?? 0) * weight * (sourceAlpha / 255);
          blue += (image.data[index + 2] ?? 0) * weight * (sourceAlpha / 255);
          alpha += sourceAlpha * weight;
          weightSum += weight;
        }
      }

      const target = (y * targetWidth + x) * 4;
      if (weightSum === 0) {
        out[target] = 0;
        out[target + 1] = 0;
        out[target + 2] = 0;
        out[target + 3] = 0;
        continue;
      }

      const alphaSum = alpha / weightSum;
      const coverage = alphaSum > 0 ? alphaSum / 255 : 0;
      out[target] = clamp(Math.round(red / weightSum / (coverage || 1)), 0, 255);
      out[target + 1] = clamp(Math.round(green / weightSum / (coverage || 1)), 0, 255);
      out[target + 2] = clamp(Math.round(blue / weightSum / (coverage || 1)), 0, 255);
      out[target + 3] = clamp(Math.round(alphaSum), 0, 255);
    }
  }

  return { width: targetWidth, height: targetHeight, data: out };
}

/** Encode a decoded image as a PNG. */
export function encodeDecodedPng(image: DecodedImage): Buffer {
  return encodePng(image.width, image.height, (x, y) => {
    const index = (y * image.width + x) * 4;
    return {
      r: image.data[index] ?? 0,
      g: image.data[index + 1] ?? 0,
      b: image.data[index + 2] ?? 0,
    };
  });
}

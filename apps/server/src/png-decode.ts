import { inflateSync } from "node:zlib";

/**
 * A small PNG reader.
 *
 * Prism resamples images locally and lets the built-in backend look at the
 * pixels of a reference image, so it needs to read PNGs. This covers the
 * formats a browser or an editor is likely to hand us: 8-bit greyscale,
 * truecolour, palette and their alpha variants, non-interlaced.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row major. */
  data: Buffer;
}

export class PngDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngDecodeError";
  }
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Undo the per-scanline filters of a PNG scanline stream. */
function unfilter(raw: Buffer, width: number, height: number, bytesPerPixel: number): Buffer {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const target = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x] ?? 0;
      const left = x >= bytesPerPixel ? (target[x - bytesPerPixel] ?? 0) : 0;
      const up = previous ? (previous[x] ?? 0) : 0;
      const upLeft = previous && x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;

      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          throw new PngDecodeError(`Unsupported scanline filter ${filter}`);
      }
      target[x] = value & 0xff;
    }
  }

  return out;
}

export function decodePng(buffer: Buffer): DecodedImage {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngDecodeError("Not a PNG file");
  }

  let offset = 8;
  let header: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null =
    null;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8] ?? 8,
        colorType: data[9] ?? 0,
        interlace: data[12] ?? 0,
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (!header) throw new PngDecodeError("The PNG has no header chunk");
  if (header.interlace !== 0) throw new PngDecodeError("Interlaced PNGs are not supported");
  if (header.bitDepth !== 8) {
    throw new PngDecodeError(`Only 8-bit PNGs are supported, got ${header.bitDepth}-bit`);
  }

  const channels = CHANNELS[header.colorType];
  if (!channels) throw new PngDecodeError(`Unsupported colour type ${header.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const pixels = unfilter(raw, header.width, header.height, channels);

  const { width, height } = header;
  const out = Buffer.alloc(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;

    if (header.colorType === 0) {
      r = g = b = pixels[source] ?? 0;
    } else if (header.colorType === 2) {
      r = pixels[source] ?? 0;
      g = pixels[source + 1] ?? 0;
      b = pixels[source + 2] ?? 0;
    } else if (header.colorType === 3) {
      const entry = (pixels[source] ?? 0) * 3;
      r = palette?.[entry] ?? 0;
      g = palette?.[entry + 1] ?? 0;
      b = palette?.[entry + 2] ?? 0;
      const alphaIndex = pixels[source] ?? 0;
      a = transparency && alphaIndex < transparency.length ? (transparency[alphaIndex] ?? 255) : 255;
    } else if (header.colorType === 4) {
      r = g = b = pixels[source] ?? 0;
      a = pixels[source + 1] ?? 0;
    } else {
      r = pixels[source] ?? 0;
      g = pixels[source + 1] ?? 0;
      b = pixels[source + 2] ?? 0;
      a = pixels[source + 3] ?? 0;
    }

    out[target] = r;
    out[target + 1] = g;
    out[target + 2] = b;
    out[target + 3] = a;
  }

  return { width, height, data: out };
}

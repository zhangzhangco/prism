import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder.
 *
 * Prism ships a mock generation provider so the whole application can be run
 * and tested without any third-party credentials. That provider still has to
 * return real image bytes, so we encode them here rather than pull in an
 * image library.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Encode 8-bit RGB pixels as a PNG.
 *
 * @param width  image width in pixels
 * @param height image height in pixels
 * @param pixel  returns the colour of a given coordinate
 */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with a filter byte. Filter 0 (None) keeps the
  // encoder simple; the zlib pass still compresses gradients well.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const { r, g, b } = pixel(x, y);
      const offset = rowStart + 1 + x * 3;
      raw[offset] = r & 0xff;
      raw[offset + 1] = g & 0xff;
      raw[offset + 2] = b & 0xff;
    }
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Read the dimensions of a PNG produced by {@link encodePng}. */
export function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(PNG_SIGNATURE)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

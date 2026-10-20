import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { encodePng, readPngSize } from "./png.js";

/** Pull the IDAT payload out of a PNG and inflate it back to raw scanlines. */
function rawScanlines(png: Buffer): Buffer {
  let offset = 8; // signature
  const parts: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") parts.push(data);
    offset += 12 + length;
  }
  return inflateSync(Buffer.concat(parts));
}

test("encodes a PNG with the requested dimensions", () => {
  const png = encodePng(8, 4, () => ({ r: 10, g: 20, b: 30 }));
  assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.deepEqual(readPngSize(png), { width: 8, height: 4 });
});

test("writes the pixel colour it was given", () => {
  const png = encodePng(2, 2, () => ({ r: 1, g: 2, b: 3 }));
  const raw = rawScanlines(png);
  // A scanline is one filter byte followed by the RGB triples. With a width
  // of two, each scanline is seven bytes long.
  const stride = 1 + 2 * 3;
  assert.equal(raw[0], 0, "the first scanline uses the none filter");
  assert.deepEqual([...raw.subarray(1, 4)], [1, 2, 3]);
  assert.equal(raw[stride], 0, "the second scanline uses the none filter");
  assert.deepEqual([...raw.subarray(stride + 1, stride + 4)], [1, 2, 3]);
});

test("rejects a buffer that is not a PNG", () => {
  assert.equal(readPngSize(Buffer.from("not a png at all")), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePng } from "./png.js";
import { decodePng, PngDecodeError } from "./png-decode.js";
import { encodeDecodedPng, resample } from "./resample.js";

test("decodes what the encoder wrote", () => {
  const source = encodePng(3, 2, (x, y) => ({ r: x * 40, g: y * 60, b: 10 }));
  const decoded = decodePng(source);
  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);

  // The first pixel is red 0, green 0, blue 10.
  assert.deepEqual([...decoded.data.subarray(0, 3)], [0, 0, 10]);
  // The second pixel of the first row is red 40.
  assert.deepEqual([...decoded.data.subarray(4, 7)], [40, 0, 10]);
  // The first pixel of the second row is green 60.
  assert.deepEqual([...decoded.data.subarray(12, 15)], [0, 60, 10]);
  // Alpha is opaque everywhere.
  assert.equal(decoded.data[3], 255);
});

test("rejects a buffer that is not a PNG", () => {
  assert.throws(() => decodePng(Buffer.from("not a png")), PngDecodeError);
});

test("resampling scales the image", () => {
  const source = encodePng(8, 8, (x, y) => ({ r: x * 30, g: y * 30, b: 0 }));
  const decoded = decodePng(source);
  const scaled = resample(decoded, 16, 16);
  assert.equal(scaled.width, 16);
  assert.equal(scaled.height, 16);
});

test("resampling keeps the colour of the source", () => {
  // A flat mid grey with a red corner: the flat area must survive the
  // resample, which is what makes an upscaled image recognisable.
  const source = encodePng(4, 4, (x, y) =>
    x === 0 && y === 0 ? { r: 200, g: 30, b: 30 } : { r: 120, g: 120, b: 120 },
  );
  const decoded = decodePng(source);
  const scaled = resample(decoded, 8, 8);

  const centre = (4 * 8 + 4) * 4;
  assert.ok(
    Math.abs((scaled.data[centre] ?? 0) - 120) <= 2,
    `expected the grey to survive, got ${scaled.data[centre]}`,
  );

  const corner = 0;
  assert.ok(
    Math.abs((scaled.data[corner] ?? 0) - 200) <= 40,
    `expected the red corner to survive, got ${scaled.data[corner]}`,
  );
});

test("re-encoding a decoded image keeps the size", () => {
  const source = encodePng(5, 7, () => ({ r: 1, g: 2, b: 3 }));
  const decoded = decodePng(source);
  const again = decodePng(encodeDecodedPng(decoded));
  assert.equal(again.width, 5);
  assert.equal(again.height, 7);
});

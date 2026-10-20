/**
 * A stand-in for an OpenAI-compatible image endpoint.
 *
 * It is deliberately strict, because the point is to catch the mistakes a
 * lenient mock would hide:
 *
 * - it rejects `response_format`, the way the GPT Image family does;
 * - it rejects a size or quality the chosen model does not accept;
 * - it requires an image part on an edit;
 * - it honours the `Idempotency-Key` header, so a repeated request returns
 *   the first answer instead of producing a second job.
 *
 * It can also be told to fail the first few attempts, which is how the
 * retry behaviour is exercised.
 */
import { createServer } from "node:http";

const GPT_IMAGE_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536", "auto"]);
const GPT_IMAGE_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const DALL_E_SIZES = new Set(["1024x1024", "1792x1024", "1024x1792", "512x512"]);
const DALL_E_QUALITIES = new Set(["standard", "hd"]);

const KNOWN_MODELS = new Set(["gpt-image-1", "dall-e-3"]);

function errorResponse(res, status, message, param, code) {
  const body = JSON.stringify({
    error: {
      message,
      type: "invalid_request_error",
      param: param ?? null,
      code: code ?? null,
    },
  });
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

/** A 1×1 PNG, enough to make a response that decodes. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!match) return { fields: {}, files: [] };
  const boundary = `--${match[1] ?? match[2]}`;
  const parts = body.toString("binary").split(boundary);
  const fields = {};
  const files = [];
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]*)"/i.exec(headers);
    const content = part.slice(headerEnd + 4).replace(/\r\n$/, "");
    if (filenameMatch) {
      files.push({
        field: nameMatch[1],
        filename: filenameMatch[1],
        bytes: Buffer.byteLength(content, "binary"),
      });
    } else {
      fields[nameMatch[1]] = content;
    }
  }
  return { fields, files };
}

export function startFakeOpenAi(options = {}) {
  const {
    port = 0,
    apiKey = "test-key",
    failFirst = 0,
    latencyMs = 0,
    onCall = () => {},
  } = options;

  const seen = new Map();
  let attempts = 0;
  let calls = 0;

  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      calls += 1;
      onCall({ url: req.url, headers: req.headers });

      const path = (req.url ?? "").split("?")[0];
      const isGeneration = path.endsWith("/images/generations");
      const isEdit = path.endsWith("/images/edits");

      if (!isGeneration && !isEdit) {
        errorResponse(res, 404, `Unknown path ${path}`);
        return;
      }

      const authorization = req.headers.authorization ?? "";
      if (authorization !== `Bearer ${apiKey}`) {
        errorResponse(res, 401, "Incorrect API key provided", null, "invalid_api_key");
        return;
      }

      const idempotencyKey = req.headers["idempotency-key"];
      if (idempotencyKey && seen.has(idempotencyKey)) {
        // The same job, answered from the cache.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(seen.get(idempotencyKey));
        return;
      }

      attempts += 1;
      if (attempts <= failFirst) {
        errorResponse(res, 500, "The server had an error while processing your request");
        return;
      }

      let fields = {};
      let files = [];
      if (isEdit) {
        const parsed = parseMultipart(body, req.headers["content-type"]);
        fields = parsed.fields;
        files = parsed.files;
        if (files.length === 0) {
          errorResponse(res, 400, "Missing required parameter: 'image'", "image", "missing_required_parameter");
          return;
        }
      } else {
        try {
          fields = JSON.parse(body.toString("utf8"));
        } catch {
          errorResponse(res, 400, "Invalid JSON in the request body");
          return;
        }
      }

      if ("response_format" in fields) {
        errorResponse(
          res,
          400,
          "Unsupported parameter: 'response_format' is not supported with this model. Use 'output_format' instead.",
          "response_format",
          "unsupported_parameter",
        );
        return;
      }

      const model = fields.model;
      if (typeof model !== "string" || !KNOWN_MODELS.has(model)) {
        errorResponse(
          res,
          404,
          `The model \`${model}\` does not exist or you do not have access to it.`,
          "model",
          "model_not_found",
        );
        return;
      }

      const sizes = model === "dall-e-3" ? DALL_E_SIZES : GPT_IMAGE_SIZES;
      const qualities = model === "dall-e-3" ? DALL_E_QUALITIES : GPT_IMAGE_QUALITIES;

      // Multipart fields always arrive as strings, so numbers are coerced
      // the way the real endpoint does.
      if (typeof fields.n === "string" && /^\d+$/.test(fields.n)) {
        fields.n = Number(fields.n);
      }

      if (typeof fields.size === "string" && !sizes.has(fields.size)) {
        errorResponse(
          res,
          400,
          `Invalid value for 'size': '${fields.size}'. Supported values are: ${[...sizes].join(", ")}.`,
          "size",
          "invalid_value",
        );
        return;
      }
      if (typeof fields.quality === "string" && !qualities.has(fields.quality)) {
        errorResponse(
          res,
          400,
          `Invalid value for 'quality': '${fields.quality}'. Supported values are: ${[...qualities].join(", ")}.`,
          "quality",
          "invalid_value",
        );
        return;
      }
      if (fields.n !== undefined && (!Number.isInteger(fields.n) || fields.n < 1 || fields.n > 10)) {
        errorResponse(res, 400, "Invalid value for 'n': expected an integer between 1 and 10.", "n", "invalid_value");
        return;
      }

      const count = typeof fields.n === "number" ? fields.n : 1;
      const payload = JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: Array.from({ length: count }, () => ({ b64_json: TINY_PNG })),
      });
      if (idempotencyKey) seen.set(idempotencyKey, payload);

      const respond = () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(payload);
      };
      if (latencyMs > 0) setTimeout(respond, latencyMs);
      else respond();
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        calls: () => calls,
        attempts: () => attempts,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.FAKE_OPENAI_PORT ?? 4390);
  const handle = await startFakeOpenAi({ port, latencyMs: 300 });
  console.log(`fake openai endpoint on ${handle.baseUrl}`);
}

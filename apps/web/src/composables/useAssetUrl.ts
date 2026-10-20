import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { AssetRef } from "@prism/contracts";
import { getToken } from "@/api/client";

/**
 * Asset images are served behind the API's bearer token, so a plain `<img>`
 * tag cannot load them. We fetch the bytes with the token and hand the
 * component an object URL instead.
 *
 * Object URLs are cached per asset id and revoked when the last consumer of
 * that asset goes away.
 */
const objectUrls = new Map<string, string>();
const consumers = new Map<string, number>();

function release(assetId: string): void {
  const remaining = (consumers.get(assetId) ?? 1) - 1;
  if (remaining > 0) {
    consumers.set(assetId, remaining);
    return;
  }
  consumers.delete(assetId);
  const url = objectUrls.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(assetId);
  }
}

async function load(asset: AssetRef): Promise<string | null> {
  const cached = objectUrls.get(asset.id);
  if (cached) return cached;

  const response = await fetch(`/api/assets/${asset.id}`, {
    headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
  });
  if (!response.ok) return null;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  objectUrls.set(asset.id, url);
  return url;
}

export function useAssetUrl(asset: Ref<AssetRef | null | undefined>) {
  const src = ref<string | null>(null);
  const failed = ref(false);
  let current: AssetRef | null = null;

  async function refresh(): Promise<void> {
    const value = asset.value;
    if (!value) {
      src.value = null;
      return;
    }
    if (current && current.id !== value.id) release(current.id);
    current = value;
    consumers.set(value.id, (consumers.get(value.id) ?? 0) + 1);
    try {
      src.value = await load(value);
      failed.value = src.value === null;
    } catch {
      failed.value = true;
    }
  }

  watch(asset, () => void refresh(), { immediate: true });

  onBeforeUnmount(() => {
    if (current) release(current.id);
  });

  return { src, failed };
}

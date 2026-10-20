import { useI18n } from "vue-i18n";

/**
 * Resolve a display label.
 *
 * The server sends a label and, when it knows one, a translation key. The
 * key wins when the catalogue has an entry for it, so a deployment can add
 * its own models without having to translate them.
 */
export function useLabel() {
  const { t, te } = useI18n();

  function label(key: string | null | undefined, fallback?: string): string {
    if (key && te(key)) return t(key);
    return fallback ?? "";
  }

  return { label, t: t as (key: string) => string };
}

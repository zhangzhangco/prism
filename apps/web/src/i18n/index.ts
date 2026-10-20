import { createI18n } from "vue-i18n";
import en from "./en";
import zhCN from "./zh-CN";

export const LOCALES = [
  { code: "zh-CN", label: "中文" },
  { code: "en", label: "English" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

const STORAGE_KEY = "prism.locale";

function initialLocale(): LocaleCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && LOCALES.some((locale) => locale.code === stored)) {
    return stored as LocaleCode;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: "en",
  messages: {
    "zh-CN": zhCN,
    en,
  },
});

export function setLocale(code: LocaleCode): void {
  i18n.global.locale.value = code;
  localStorage.setItem(STORAGE_KEY, code);
  document.documentElement.lang = code;
}

document.documentElement.lang = i18n.global.locale.value;

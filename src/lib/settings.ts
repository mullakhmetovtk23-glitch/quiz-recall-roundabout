import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePref;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  llmBaseUrl: "https://api.openai.com/v1",
  llmModel: "gpt-4o-mini",
  llmApiKey: "",
};

const KEY = "bingo-trainer-settings";
export const THEME_KEY = "bingo-trainer-theme";

export function readSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function applyTheme(pref: ThemePref) {
  if (typeof window === "undefined") return;
  const tg = (window as unknown as { Telegram?: { WebApp?: { colorScheme?: string; initData?: string } } }).Telegram?.WebApp;
  const systemDark =
    tg?.initData && tg.colorScheme
      ? tg.colorScheme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = pref === "dark" || (pref === "system" && systemDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(readSettings()), []);
  const save = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.localStorage.setItem(THEME_KEY, next.theme);
      applyTheme(next.theme);
      return next;
    });
  }, []);
  return { settings, save };
}

/** Runs before paint (inline in <head>) to avoid a light flash in dark mode. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

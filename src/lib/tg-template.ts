export const DEFAULT_TG_TEMPLATE = "<b>{{term}}</b>\n\n🪝 {{hook}}\n\n{{full_text}}\n\n🏷 {{categories}}";
export const TG_TEXT_LIMIT = 4000;
export const TG_CAPTION_LIMIT = 1000;

export interface TgPostVars {
  term: string;
  hook: string;
  full_text: string;
  categories: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/** Escaped, cut on whole characters (never inside an &entity; or a surrogate pair) to fit `budget`. */
function truncateEscaped(raw: string, budget: number): string {
  if (budget <= 1) return "";
  const chars = Array.from(raw);
  let n = chars.length;
  for (;;) {
    const s = escapeHtml(chars.slice(0, n).join("").trimEnd() + (n < chars.length ? "…" : ""));
    if (s.length <= budget || n === 0) return s.length <= budget ? s : "";
    n = Math.max(0, n - Math.max(1, s.length - budget));
  }
}

/**
 * Fills {{term}}, {{hook}}, {{full_text}}, {{categories}} with HTML-escaped values and keeps the
 * result within `limit` characters by shortening full_text first, then hook, then term.
 */
export function renderTgPost(template: string, vars: TgPostVars, limit: number): string {
  const current: Record<string, string> = {
    term: escapeHtml(vars.term),
    hook: escapeHtml(vars.hook),
    full_text: escapeHtml(vars.full_text),
    categories: escapeHtml(vars.categories),
  };
  let out = fill(template, current);
  if (out.length <= limit) return out;
  for (const key of ["full_text", "hook", "term"] as const) {
    const base = fill(template, { ...current, [key]: "" }).length;
    current[key] = truncateEscaped(vars[key], limit - base);
    out = fill(template, current);
    if (out.length <= limit) return out;
  }
  // The template itself is too long: fall back to plain text.
  const plain = out.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return truncateEscaped(plain, limit);
}

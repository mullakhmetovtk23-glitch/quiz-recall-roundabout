import { SINGLE_LABEL_SYSTEM_PROMPT, buildLabelUserPrompt, normalizeLabel } from "./label-prompt";
import type { LabelResult, ImproveResult } from "./ai.functions";
import { IMPROVE_SYSTEM_PROMPT, buildImproveUserPrompt, normalizeCategoryNames } from "./label-prompt";
import type { AppSettings } from "./settings";
import type { AtomicCardLabel, BatchLabelResult } from "./ai.functions";
import { callOwnLlm } from "./ai.functions";

async function callOwnLlmServer(apiKey: string, messages: { role: string; content: string }[]) {
  return callOwnLlm({ data: { apiKey, messages } });
}

export type LlmProvider = "github" | "openrouter" | "gemini" | "mistral";

export function resolveLlmProvider(apiKey: string): { provider: LlmProvider; url: string; model: string } {
  const key = apiKey.trim();
  if (key.startsWith("ghp_") || key.startsWith("github_pat_")) {
    return { provider: "github", url: "https://models.github.ai/inference/chat/completions", model: "gpt-4o-mini" };
  }
  if (key.startsWith("sk-or-")) {
    return { provider: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/free" };
  }
  if (key.startsWith("AIza")) {
    return { provider: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", model: "gemini-2.5-flash" };
  }
  return { provider: "mistral", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" };
}

export class LlmHttpError extends Error {
  constructor(public status: number, public responseBody: string) {
    super(`HTTP ${status}: ${responseBody || "пустой ответ сервера"}`);
  }
}

export async function callCustomLlm(apiKey: string, messages: { role: string; content: string }[], jsonMode = true) {
  const key = apiKey.trim();
  if (!key) throw new Error("Пользовательский ключ не задан");
  const serverResult = await callOwnLlmServer(key, messages);
  if (!serverResult.ok) {
    if (/^HTTP 429/i.test(serverResult.error)) throw new LlmHttpError(429, serverResult.error);
    throw new Error(serverResult.error);
  }
  return { content: serverResult.content, status: 200 };

}

export async function labelPostBatchWithOwnKey(
  posts: { id: number; text: string }[],
  categories: string[],
  settings: AppSettings,
): Promise<BatchLabelResult> {
  try {
    const result = await callCustomLlm(settings.llmApiKey, [
      { role: "system", content: "Разбей каждый Telegram-пост на от 1 до 6 атомарных карточек ЧГК. Верни JSON {items:[{id,cards:[{term,hook,full_text,category_names}]}]}. Категории строго из переданного списка, 1–3 для карточки." },
      { role: "user", content: JSON.stringify({ categories, posts }) },
    ]);
    const raw = JSON.parse(result.content || '{"items":[]}') as { items?: unknown[] };
    const items: Record<number, AtomicCardLabel[]> = {};
    for (const item of Array.isArray(raw.items) ? raw.items : []) {
      if (!item || typeof item !== "object") continue;
      const id = Number((item as any).id);
      if (!posts.some((p) => p.id === id)) continue;
      const cards = ((item as any).cards as unknown[] ?? []).slice(0, 6);
      const normalized = cards.map((c: any) => ({
        term: typeof c.term === "string" ? c.term.trim() : "",
        hook: typeof c.hook === "string" ? c.hook.trim() : "",
        full_text: typeof c.full_text === "string" ? c.full_text.trim() : "",
        category_names: normalizeCategoryNames(c.category_names, categories),
      })).filter((c: AtomicCardLabel) => c.term && c.full_text);
      if (normalized.length) items[id] = normalized;
    }
    return { ok: true, items };
  } catch (e) {
    const error = e instanceof LlmHttpError
      ? e.message
      : e instanceof SyntaxError
        ? `Невалидный JSON в ответе ИИ: ${e.message}`
        : e instanceof Error
          ? `Сетевая ошибка ИИ: ${e.message}`
          : "Неизвестная ошибка API ИИ";
    return { ok: false, stop: true, error: `${error}. Импорт поставлен на паузу.` };
  }
}

/** Calls the user's own OpenAI-compatible endpoint straight from the browser. */
export async function labelWithOwnKey(
  text: string,
  categories: string[],
  settings: AppSettings,
): Promise<LabelResult> {
  try {
    const result = await callCustomLlm(settings.llmApiKey, [
      { role: "system", content: `${SINGLE_LABEL_SYSTEM_PROMPT}\nОтвечай только JSON.` },
      { role: "user", content: buildLabelUserPrompt(text, categories) },
    ]);
    return { ok: true, label: normalizeLabel(JSON.parse(result.content), categories) };
  } catch (e) {
    return {
      ok: false,
      stop: false,
      error: e instanceof Error ? e.message : "Не удалось связаться с API",
    };
  }
}

export async function improveCardWithOwnKey(
  term: string,
  hook: string,
  fullText: string,
  categories: string[],
  comment: string,
  settings: AppSettings,
): Promise<ImproveResult> {
  try {
    const result = await callCustomLlm(settings.llmApiKey, [
      { role: "system", content: `${IMPROVE_SYSTEM_PROMPT}\nОтвечай только JSON.` },
      { role: "user", content: buildImproveUserPrompt(term, hook, fullText, categories, comment) },
    ]);
    const raw = JSON.parse(result.content || "{}") as Record<string, unknown>;
    return { ok: true, card: {
      term: typeof raw["term"] === "string" ? raw["term"].trim() : term,
      hook: typeof raw["hook"] === "string" ? raw["hook"].trim() : hook,
      full_text: typeof raw["full_text"] === "string" ? raw["full_text"].trim() : fullText,
      category_names: normalizeCategoryNames(raw["category_names"], categories),
    }};
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось связаться с API ИИ" };
  }
}

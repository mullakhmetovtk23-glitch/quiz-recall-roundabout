import { SINGLE_LABEL_SYSTEM_PROMPT, buildLabelUserPrompt, normalizeLabel } from "./label-prompt";
import type { LabelResult, ImproveResult } from "./ai.functions";
import { IMPROVE_SYSTEM_PROMPT, buildImproveUserPrompt, normalizeCategoryNames } from "./label-prompt";
import type { AppSettings } from "./settings";
import type { AtomicCardLabel, BatchLabelResult } from "./ai.functions";

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

async function readError(res: Response): Promise<LlmHttpError> {
  const body = await res.text().catch(() => "");
  return new LlmHttpError(res.status, body);
}

export async function checkApiKey(apiKey: string): Promise<{ ok: true; provider: string } | { ok: false; error: string }> {
  try {
    const key = apiKey.trim();
    if (!key) return { ok: false, error: "Ключ не введён" };
    const provider = resolveLlmProvider(key);
    const providerName = provider.provider === "github" ? "GitHub Models" : provider.provider === "openrouter" ? "OpenRouter" : provider.provider === "gemini" ? "Google Gemini" : "Mistral AI";

    if (provider.provider === "gemini") {
      const res = await fetch(`${provider.url}?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with OK" }] }],
          generationConfig: { maxOutputTokens: 16 },
        }),
      });
      if (!res.ok) throw await readError(res);
      const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      return text ? { ok: true, provider: providerName } : { ok: false, error: "Ответ провайдера не содержит текста" };
    }

    const urls = provider.provider === "github"
      ? ["https://models.inference.ai.azure.com/chat/completions", "https://models.github.ai/inference/chat/completions"]
      : [provider.url];

    for (const url of urls) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 16 }),
      });
      if (res.ok) {
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        const text = json.choices?.[0]?.message?.content?.trim() ?? "";
        return text ? { ok: true, provider: providerName } : { ok: false, error: "Ответ провайдера не содержит текста" };
      }
      if (provider.provider === "github" && url === urls[0] && (res.status === 404 || res.status === 401)) continue;
      throw await readError(res);
    }
    throw new Error("GitHub Models не ответил доступным endpoint");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Сетевая ошибка API ИИ" };
  }
}

export async function callCustomLlm(apiKey: string, messages: { role: string; content: string }[], jsonMode = true) {
  const key = apiKey.trim();
  if (!key) throw new Error("Пользовательский ключ не задан");
  const provider = resolveLlmProvider(key);

  if (provider.provider === "gemini") {
    const res = await fetch(`${provider.url}?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: messages.find((m) => m.role === "system")?.content ?? "" }] },
        contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: jsonMode ? { responseMimeType: "application/json" } : {},
      }),
    });
    if (!res.ok) throw await readError(res);
    const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return { content: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", status: res.status };
  }

  const urls = provider.provider === "github"
    ? ["https://models.inference.ai.azure.com/chat/completions", "https://models.github.ai/inference/chat/completions"]
    : [provider.url];

  for (const url of urls) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: provider.model, ...(jsonMode ? { response_format: { type: "json_object" } } : {}), messages }),
    });
    if (res.ok) {
      const json = await res.json() as { choices?: { message?: { content?: string } }[] };
      return { content: json.choices?.[0]?.message?.content ?? "", status: res.status };
    }
    if (provider.provider === "github" && url === urls[0] && (res.status === 404 || res.status === 401)) continue;
    throw await readError(res);
  }
  throw new Error("GitHub Models не ответил доступным endpoint");
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

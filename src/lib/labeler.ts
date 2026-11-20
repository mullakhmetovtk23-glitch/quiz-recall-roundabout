import { SINGLE_LABEL_SYSTEM_PROMPT, buildLabelUserPrompt, normalizeLabel } from "./label-prompt";
import type { LabelResult, ImproveResult } from "./ai.functions";
import { IMPROVE_SYSTEM_PROMPT, buildImproveUserPrompt, normalizeCategoryNames } from "./label-prompt";
import type { AppSettings } from "./settings";

/** Calls the user's own OpenAI-compatible endpoint straight from the browser. */
export async function labelWithOwnKey(
  text: string,
  categories: string[],
  settings: AppSettings,
): Promise<LabelResult> {
  try {
    const res = await fetch(`${settings.llmBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.llmApiKey}` },
      body: JSON.stringify({
        model: settings.llmModel,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${SINGLE_LABEL_SYSTEM_PROMPT}\nОтвечай только JSON.` },
          { role: "user", content: buildLabelUserPrompt(text, categories) },
        ],
      }),
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, stop: true, error: "Ключ API не подошёл — проверьте его в настройках." };
    if (res.status === 429 || res.status === 402)
      return { ok: false, stop: true, error: "Лимит вашего ключа API исчерпан. Подождите и продолжите." };
    if (!res.ok) return { ok: false, stop: false, error: `Ошибка API: ${res.status}` };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { ok: true, label: normalizeLabel(JSON.parse(content), categories) };
  } catch {
    return { ok: false, stop: false, error: "Не удалось связаться с API" };
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
    const res = await fetch(`${settings.llmBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.llmApiKey}` },
      body: JSON.stringify({
        model: settings.llmModel,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${IMPROVE_SYSTEM_PROMPT}\nОтвечай только JSON.` },
          { role: "user", content: buildImproveUserPrompt(term, hook, fullText, categories, comment) },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `Ошибка API: ${res.status}` };
    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    return { ok: true, card: {
      term: typeof raw.term === "string" ? raw.term.trim() : term,
      hook: typeof raw.hook === "string" ? raw.hook.trim() : hook,
      full_text: typeof raw.full_text === "string" ? raw.full_text.trim() : fullText,
      category_names: normalizeCategoryNames(raw.category_names, categories),
    }};
  } catch {
    return { ok: false, error: "Не удалось связаться с API ИИ" };
  }
}

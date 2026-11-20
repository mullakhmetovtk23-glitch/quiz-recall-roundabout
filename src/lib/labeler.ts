import { LABEL_SYSTEM_PROMPT, buildLabelUserPrompt, normalizeLabel } from "./label-prompt";
import type { LabelResult } from "./ai.functions";
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
          { role: "system", content: `${LABEL_SYSTEM_PROMPT}\nОтвечай только JSON.` },
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

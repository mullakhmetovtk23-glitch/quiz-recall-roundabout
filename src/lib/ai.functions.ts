import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  GatewayError,
  PaymentRequiredError,
  RateLimitError,
  generateChatCompletion,
} from "@lovable.dev/ai-gateway";
import {
  SINGLE_LABEL_SYSTEM_PROMPT,
  buildLabelUserPrompt,
  normalizeLabel,
  IMPROVE_SYSTEM_PROMPT,
  buildImproveUserPrompt,
  normalizeCategoryNames,
  type PostLabel,
  type ImprovedCard,
  BATCH_ATOMIC_SYSTEM_PROMPT,
} from "./label-prompt";

const inputSchema = z.object({
  text: z.string().min(1).max(12000),
  categories: z.array(z.string().max(120)).max(60),
});

export type LabelResult =
  | { ok: true; label: PostLabel }
  | { ok: false; error: string; stop: boolean };

export interface AtomicCardLabel {
  term: string;
  hook: string;
  full_text: string;
  category_names: string[];
}

export type BatchLabelResult =
  | { ok: true; items: Record<number, AtomicCardLabel[]> }
  | { ok: false; error: string; stop: boolean };

export type OwnLlmProvider = "github" | "openrouter" | "gemini" | "vertex" | "groq" | "mistral";

export function resolveOwnLlmProvider(apiKey: string): { provider: OwnLlmProvider; url: string; model: string } {
  const key = apiKey.trim();
  if (key.startsWith("AQ."))
    return { provider: "vertex", url: "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent", model: "gemini-2.5-flash" };
  if (key.startsWith("AIza"))
    return { provider: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", model: "gemini-2.5-flash" };
  if (key.startsWith("ghp_") || key.startsWith("github_pat_"))
    return { provider: "github", url: "https://models.inference.ai.azure.com/chat/completions", model: "gpt-4o-mini" };
  if (key.startsWith("gsk_"))
    return { provider: "groq", url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" };
  if (key.startsWith("sk-or-"))
    return { provider: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/free" };
  return { provider: "mistral", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" };
}

function providerName(provider: OwnLlmProvider): string {
  return provider === "github" ? "GitHub Models"
    : provider === "openrouter" ? "OpenRouter"
    : provider === "vertex" ? "Google Gemini (Vertex AI)"
    : provider === "gemini" ? "Google AI Studio"
    : provider === "groq" ? "Groq"
    : "Mistral AI";
}

async function performOwnLlmRequest(apiKey: string, messages: { role: string; content: string }[]) {
  const key = apiKey.trim();
  if (!key) throw new Error("Пользовательский ключ не задан");
  const resolved = resolveOwnLlmProvider(key);

  if (resolved.provider === "gemini" || resolved.provider === "vertex") {
    const vertexUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const studioUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const urls = resolved.provider === "vertex" ? [vertexUrl, studioUrl] : [studioUrl];
    let lastError = "";
    for (const url of urls) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: messages.map((m) => m.content).join("\n\n") }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      const body = await res.text();
      if (res.ok) {
        const json = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return { content: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", provider: resolved.provider };
      }
      if (resolved.provider === "vertex" && url === vertexUrl && (res.status === 400 || res.status === 404)) continue;
      throw new Error(`HTTP ${res.status}: ${body || "пустой ответ сервера"}`);
    }
    throw new Error(lastError || "Google Gemini не ответил доступным endpoint");
  }

  const urls = resolved.provider === "github"
    ? [resolved.url, "https://models.inference.ai.azure.com/chat/completions"]
    : [resolved.url];

  let lastError = "";
  for (const url of urls) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: resolved.model, response_format: { type: "json_object" }, messages }),
    });
    const body = await res.text();
    if (res.ok) {
      const json = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
      return { content: json.choices?.[0]?.message?.content ?? "", provider: resolved.provider };
    }
    lastError = `HTTP ${res.status}: ${body || "пустой ответ сервера"}`;
    if (resolved.provider === "github" && url === urls[0] && (res.status === 404 || res.status === 401)) continue;
    throw new Error(lastError);
  }
  throw new Error(lastError);
}

const ownLlmSchema = z.object({
  apiKey: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1).max(20),
});

export const callOwnLlm = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ownLlmSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const result = await callOwnLlmInternal(data.apiKey, data.messages);
      return { ok: true, content: result.content, provider: providerName(result.provider) } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка API ИИ" } as const;
    }
  });

async function callOwnLlmInternal(apiKey: string, messages: { role: string; content: string }[]) {
  return performOwnLlmRequest(apiKey, messages);
}

export const checkOwnLlmKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ apiKey: z.string() }).parse(d))
  .handler(async ({ data }) => {
    if (!data.apiKey.trim()) return { ok: false, error: "Ключ не введён" } as const;
    try {
      const resolved = resolveOwnLlmProvider(data.apiKey);
      await callOwnLlmInternal(data.apiKey, [
        { role: "system", content: "Ответь только одним словом: OK" },
        { role: "user", content: "Проверка ключа" },
      ]);
      return { ok: true, provider: providerName(resolved.provider) } as const;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка API ИИ" } as const;
    }
  });

const batchInputSchema = z.object({
  posts: z.array(z.object({ id: z.number(), text: z.string().min(1).max(4000) })).min(1).max(5),
  categories: z.array(z.string().max(120)).max(60),
});

export const labelPostBatch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => batchInputSchema.parse(d))
  .handler(async ({ data }): Promise<BatchLabelResult> => {
    try {
      const res = await generateChatCompletion({
        model: "openai/gpt-6-astra",
        messages: [
          { role: "system", content: BATCH_ATOMIC_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ categories: data.categories, posts: data.posts }) },
        ],
        response_format: {
          type: "json_object",
        },
      });
      const raw = JSON.parse(res.choices[0]?.message?.content ?? '{"items":[]}') as { items?: unknown[] };
      const items: Record<number, AtomicCardLabel[]> = {};
      for (const item of Array.isArray(raw.items) ? raw.items : []) {
        if (!item || typeof item !== "object") continue;
        const id = Number((item as any).id);
        if (!data.posts.some((p) => p.id === id)) continue;
        const cards = (Array.isArray((item as any).cards) ? (item as any).cards : []).slice(0, 6);
        const normalized = cards.map((c: any) => ({
          term: typeof c.term === "string" ? c.term.trim() : "",
          hook: typeof c.hook === "string" ? c.hook.trim() : "",
          full_text: typeof c.full_text === "string" ? c.full_text.trim() : "",
          category_names: normalizeCategoryNames(c.category_names, data.categories),
        })).filter((c: AtomicCardLabel) => c.term && c.full_text);
        if (normalized.length) items[id] = normalized;
      }
      return { ok: true, items };
    } catch (e) {
      console.error("labelPostBatch failed", e);
      if (e instanceof PaymentRequiredError)
        return { ok: false, stop: true, error: "Закончились кредиты ИИ — пополните баланс и продолжите." };
      if (e instanceof RateLimitError)
        return { ok: false, stop: true, error: "429: лимит ИИ. Пауза 15 секунд." };
      if (e instanceof GatewayError)
        return { ok: false, stop: true, error: "ИИ не смог обработать батч. Импорт поставлен на паузу." };
      return { ok: false, stop: true, error: "Не удалось разобрать ответ ИИ. Импорт поставлен на паузу." };
    }
  });

/** Turns a post into { term, hook, category_name } with the built-in AI. */
export const labelPost = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }): Promise<LabelResult> => {
    const categoryProp =
      data.categories.length > 0
        ? { type: "string", enum: data.categories }
        : { type: "string" };
    try {
      const res = await generateChatCompletion({
        model: "openai/gpt-6-astra",
        messages: [
          { role: "system", content: SINGLE_LABEL_SYSTEM_PROMPT },
          { role: "user", content: buildLabelUserPrompt(data.text, data.categories) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "card_label",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                term: { type: "string" },
                hook: { type: "string" },
                category_names: { type: "array", items: categoryProp },
              },
              required: ["term", "hook", "category_names"],
            },
          },
        },
      });
      const content = res.choices[0]?.message?.content;
      const text = typeof content === "string" ? content : "";
      return { ok: true, label: normalizeLabel(JSON.parse(text), data.categories) };
    } catch (e) {
      console.error("labelPost failed", e);
      if (e instanceof PaymentRequiredError)
        return { ok: false, stop: true, error: "Закончились кредиты ИИ — пополните баланс и продолжите." };
      if (e instanceof RateLimitError)
        return { ok: false, stop: true, error: "Слишком много запросов к ИИ. Подождите минуту и продолжите." };
      if (e instanceof GatewayError) return { ok: false, stop: false, error: "ИИ не смог обработать пост" };
      return { ok: false, stop: false, error: "Не удалось разобрать ответ ИИ" };
    }
  });

const improveSchema = z.object({
  term: z.string(), hook: z.string(), full_text: z.string(),
  categories: z.array(z.string().max(120)).max(60), comment: z.string().optional(),
});
export type ImproveResult = { ok: true; card: ImprovedCard } | { ok: false; error: string };

export const improveCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => improveSchema.parse(d))
  .handler(async ({ data }): Promise<ImproveResult> => {
    try {
      const res = await generateChatCompletion({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: IMPROVE_SYSTEM_PROMPT },
          { role: "user", content: buildImproveUserPrompt(data.term, data.hook, data.full_text, data.categories, data.comment ?? "") },
        ],
        response_format: { type: "json_object" },
      });
      const text = res.choices[0]?.message?.content;
      const raw = JSON.parse(typeof text === "string" ? text : "{}") as Record<string, unknown>;
      return { ok: true, card: {
        term: typeof raw["term"] === "string" ? raw["term"].trim() : data.term,
        hook: typeof raw["hook"] === "string" ? raw["hook"].trim() : data.hook,
        full_text: typeof raw["full_text"] === "string" ? raw["full_text"].trim() : data.full_text,
        category_names: normalizeCategoryNames(raw["category_names"], data.categories),
      }};
    } catch (e) {
      console.error("improveCard failed", e);
      return { ok: false, error: "Не удалось улучшить карточку через ИИ" };
    }
  });

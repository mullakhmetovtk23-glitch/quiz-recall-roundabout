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
} from "./label-prompt";

const inputSchema = z.object({
  text: z.string().min(1).max(12000),
  categories: z.array(z.string().max(120)).max(60),
});

export type LabelResult =
  | { ok: true; label: PostLabel }
  | { ok: false; error: string; stop: boolean };

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
        term: typeof raw.term === "string" ? raw.term.trim() : data.term,
        hook: typeof raw.hook === "string" ? raw.hook.trim() : data.hook,
        full_text: typeof raw.full_text === "string" ? raw.full_text.trim() : data.full_text,
        category_names: normalizeCategoryNames(raw.category_names, data.categories),
      }};
    } catch (e) {
      console.error("improveCard failed", e);
      return { ok: false, error: "Не удалось улучшить карточку через ИИ" };
    }
  });

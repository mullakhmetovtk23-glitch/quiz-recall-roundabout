import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  GatewayError,
  PaymentRequiredError,
  RateLimitError,
  generateChatCompletion,
} from "@lovable.dev/ai-gateway";
import { SINGLE_LABEL_SYSTEM_PROMPT, buildLabelUserPrompt, normalizeLabel, type PostLabel } from "./label-prompt";

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

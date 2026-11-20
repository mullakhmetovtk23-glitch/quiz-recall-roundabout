export interface PostLabel {
  term: string;
  hook: string;
  category_name: string;
}

export const LABEL_SYSTEM_PROMPT = `Ты помогаешь готовиться к интеллектуальным играм (ЧГК, Своя игра). Из заметки-поста нужно сделать карточку для интервального повторения.
Верни строго JSON с полями:
- "term": короткий ответ, 1–4 слова (имя, понятие, название) — то, что нужно запомнить;
- "hook": вопрос-крючок на русском из 2–3 ключевых признаков, по которым можно догадаться об ответе, НЕ называя сам ответ и однокоренные слова;
- "category_name": название наиболее подходящей категории строго из переданного списка (если список пуст — пустая строка).`;

export function buildLabelUserPrompt(text: string, categories: string[]): string {
  return `Категории: ${categories.length ? categories.map((c) => `«${c}»`).join(", ") : "(нет)"}

Пост:
"""
${text.slice(0, 6000)}
"""`;
}

export function normalizeLabel(raw: unknown, categories: string[]): PostLabel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const wanted = str(o["category_name"]).toLowerCase();
  const category = categories.find((c) => c.toLowerCase() === wanted) ?? "";
  return { term: str(o["term"]), hook: str(o["hook"]), category_name: category };
}

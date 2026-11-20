export interface PostLabel {
  term: string;
  hook: string;
  /** 1–3 category names taken strictly from the provided list (empty when the list is empty). */
  category_names: string[];
}

export const MAX_CATEGORIES = 3;

const FIELD_RULES = `- "term": короткий ответ, 1–4 слова (имя, понятие, название) — то, что нужно запомнить;
- "hook": вопрос-крючок на русском из 2–3 ключевых признаков, по которым можно догадаться об ответе, НЕ называя сам ответ и однокоренные слова;
- "category_names": массив из 1–3 наиболее подходящих категорий строго из переданного списка. Если факт на стыке тем (например, картина на мифологический сюжет), укажи несколько категорий. Если список пуст — пустой массив.`;

export const LABEL_SYSTEM_PROMPT = `Ты помогаешь готовиться к интеллектуальным играм (ЧГК, Своя игра). Из заметок-постов нужно делать карточки для интервального повторения.
Тебе дают несколько постов, у каждого есть числовой id. Для КАЖДОГО поста верни объект с полями:
- "id": id поста без изменений;
${FIELD_RULES}
Ответ — строго JSON вида {"items": [...]}.`;

export const BOT_SYSTEM_PROMPT = `Ты помогаешь готовиться к интеллектуальным играм (ЧГК, Своя игра). Из поста Telegram-канала нужно сделать карточку для интервального повторения.
Верни строго JSON с полями:
${FIELD_RULES}
- "rewritten_text": аккуратно переписанный текст поста — исправь опечатки, сделай текст связным и читаемым, сохрани ВСЕ факты, даты и имена. Без HTML-разметки, без хэштегов, не начинай с термина.`;

export function categoriesLine(categories: string[]): string {
  return `Категории: ${categories.length ? categories.map((c) => `«${c}»`).join(", ") : "(нет)"}`;
}

export function withChannelPrompt(system: string, channelPrompt: string | null | undefined): string {
  const extra = channelPrompt?.trim();
  return extra ? `${system}\n\nОсобая инструкция для этого канала:\n${extra}` : system;
}

export function buildBatchUserPrompt(posts: { id: number; text: string }[], categories: string[]): string {
  const body = posts.map((p) => `### Пост id=${p.id}\n"""\n${p.text.slice(0, 4000)}\n"""`).join("\n\n");
  return `${categoriesLine(categories)}\n\n${body}`;
}

export function buildBotUserPrompt(text: string, categories: string[]): string {
  return `${categoriesLine(categories)}\n\nПост:\n"""\n${(text || "(текста нет, только картинка)").slice(0, 6000)}\n"""`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Keeps only names from the list (case-insensitive), without duplicates, at most 3. */
export function normalizeCategoryNames(raw: unknown, categories: string[]): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const item of list) {
    const wanted = str(item).toLowerCase();
    const match = categories.find((c) => c.toLowerCase() === wanted);
    if (match && !out.includes(match)) out.push(match);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

export function normalizeLabel(raw: unknown, categories: string[]): PostLabel {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    term: str(o["term"]),
    hook: str(o["hook"]),
    category_names: normalizeCategoryNames(o["category_names"] ?? o["category_name"], categories),
  };
}

/** Maps a batch answer {items:[{id,...}]} to labels for the requested ids only. */
export function normalizeBatch(raw: unknown, ids: number[], categories: string[]): Map<number, PostLabel> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(o["items"]) ? (o["items"] as unknown[]) : [];
  const wanted = new Set(ids);
  const out = new Map<number, PostLabel>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = Number((item as Record<string, unknown>)["id"]);
    if (!wanted.has(id) || out.has(id)) continue;
    const label = normalizeLabel(item, categories);
    if (label.term) out.set(id, label);
  }
  return out;
}

/** Import without AI: first line → term, the rest → hook. */
export interface ImprovedCard {
  term: string;
  hook: string;
  full_text: string;
  category_names: string[];
}

export function buildImproveUserPrompt(term: string, hook: string, fullText: string, categories: string[], comment: string): string {
  return `${categoriesLine(categories)}\n\nТекущая карточка:\nterm: ${term}\nhook: ${hook}\nfull_text: ${fullText}\n\nПожелание пользователя: ${comment || "улучши карточку"}\nВерни JSON с полями term, hook, full_text, category_names.`;
}

export const IMPROVE_SYSTEM_PROMPT = `Ты редактор карточек для подготовки к ЧГК и «Своей игре». Улучшай точность и запоминаемость. term — точный короткий ответ; hook — 2–3 ярких признака без прямой подсказки и однокоренных слов; full_text — структурированные ключевые факты, даты, имена и ассоциации; category_names — от 1 до 3 названий строго из списка категорий. Ответ только JSON.`;

export function basicLabel(text: string): { term: string; hook: string } {
  const lines = text.trim().split(/\r?\n/);
  const first = (lines.shift() ?? "").trim();
  return { term: first.slice(0, 200), hook: lines.join("\n").trim() };
}

export const SINGLE_LABEL_SYSTEM_PROMPT = `Ты помогаешь готовиться к интеллектуальным играм (ЧГК, Своя игра). Из заметки-поста нужно сделать карточку для интервального повторения.
Верни строго JSON с полями:
${FIELD_RULES}`;

export function buildLabelUserPrompt(text: string, categories: string[]): string {
  return `${categoriesLine(categories)}\n\nПост:\n"""\n${text.slice(0, 6000)}\n"""`;
}

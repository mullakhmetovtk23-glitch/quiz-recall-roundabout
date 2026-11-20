export type TgTextPart = string | { type?: string; text?: string; href?: string };

export interface TgMessage {
  id: number;
  type: string;
  date?: string;
  text?: string | TgTextPart[];
  photo?: string;
  file?: string;
  mime_type?: string;
}

export interface ParsedPost {
  tgMessageId: number;
  date: string | null;
  text: string;
  photo: string | null;
}

export interface ParsedExport {
  chatId: string;
  chatName: string;
  posts: ParsedPost[];
}

/** Joins Telegram's `text` field: plain strings plus `.text` of formatting objects (bold, link, italic…). */
export function flattenText(text: TgMessage["text"]): string {
  if (text == null) return "";
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return text
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function photoOf(m: TgMessage): string | null {
  if (typeof m.photo === "string" && m.photo && !m.photo.startsWith("(")) return m.photo;
  if (typeof m.file === "string" && m.mime_type?.startsWith("image/") && !m.file.startsWith("(")) return m.file;
  return null;
}

export function parseTelegramExport(json: unknown): ParsedExport {
  if (!json || typeof json !== "object") throw new Error("Файл не похож на экспорт Telegram");
  const root = json as { id?: number | string; name?: string; messages?: unknown };
  if (!Array.isArray(root.messages)) throw new Error("В файле нет массива messages");

  const posts: ParsedPost[] = [];
  for (const raw of root.messages as TgMessage[]) {
    if (!raw || raw.type !== "message" || typeof raw.id !== "number") continue;
    const text = flattenText(raw.text).trim();
    const photo = photoOf(raw);
    if (!text && !photo) continue;
    posts.push({ tgMessageId: raw.id, date: raw.date ?? null, text, photo });
  }

  return {
    chatId: String(root.id ?? root.name ?? "unknown"),
    chatName: root.name ?? "Без названия",
    posts,
  };
}

/** Maps relative paths inside the export folder (e.g. "photos/photo_1.jpg") to the picked files. */
export function buildPhotoMap(files: File[]): { resultFile: File | null; photos: Map<string, File> } {
  const withPath = files.map((f) => ({ f, path: (f.webkitRelativePath || f.name).replace(/\\/g, "/") }));
  const results = withPath
    .filter((x) => x.path.split("/").pop() === "result.json")
    .sort((a, b) => a.path.length - b.path.length);
  const result = results[0] ?? null;
  const base = result ? result.path.slice(0, result.path.length - "result.json".length) : "";
  const photos = new Map<string, File>();
  for (const { f, path } of withPath) {
    if (path.startsWith(base) && path !== result?.path) photos.set(path.slice(base.length), f);
  }
  return { resultFile: result?.f ?? null, photos };
}

/** Export ids lack the "-100" prefix the Bot API uses: "1234567890" ≡ "-1001234567890". */
export function normalizeTgChatId(id: string | number | null | undefined): string {
  return String(id ?? "").trim().replace(/^-100(?=\d{6,})/, "").replace(/^-/, "");
}

export function sameTgChat(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  const x = normalizeTgChatId(a);
  return x !== "" && x === normalizeTgChatId(b);
}

export const WEBHOOK_PATH = "/api/public/telegram-webhook";

/** The auth-protected editor preview host can't receive webhooks; its public twin can. */
export function publicWebhookUrl(origin: string): string {
  const url = new URL(origin);
  const m = url.hostname.match(/^id-preview--([^.]+)\.(.+)$/);
  const host = m ? `project--${m[1]}-dev.${m[2]}` : url.host;
  return `https://${host}${WEBHOOK_PATH}`;
}

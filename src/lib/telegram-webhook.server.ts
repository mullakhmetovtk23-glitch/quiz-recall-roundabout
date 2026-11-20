import { generateChatCompletion } from "@lovable.dev/ai-gateway";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

async function getBotToken(): Promise<string | null> {
  const envToken = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  if (envToken) return envToken;
  const { data } = await (supabaseAdmin as any).from("app_settings").select("value").eq("key", "telegram_bot_token").maybeSingle();
  return typeof data?.value === "string" && data.value.trim() ? data.value.trim() : null;
}

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  let update: any;
  try { update = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
  const post = update.channel_post ?? update.edited_channel_post;
  if (!post) return Response.json({ ok: true });

  const token = await getBotToken();
  if (!token) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN missing" }, { status: 500 });

  const chat = post.chat;
  let { data: channel } = await (supabaseAdmin as any).from("channels").select("*").eq("tg_chat_id", String(chat.id)).maybeSingle();
  if (!channel) {
    const created = await (supabaseAdmin as any).from("channels").insert({
      name: chat.title ?? `Telegram ${chat.id}`, tg_chat_id: String(chat.id), color: "#2a9d8f",
    }).select("*").single();
    channel = created.data;
  }
  if (!channel) return Response.json({ ok: false, error: "channel create failed" }, { status: 500 });

  const text = post.text ?? post.caption ?? "";
  const { data: channels } = await (supabaseAdmin as any).from("channels").select("id,name").order("sort_order");
  const names = (channels ?? []).map((c: any) => c.name as string);
  let cards: Array<{ term: string; hook: string; full_text: string; category_names: string[] }> = [];

  if (text.trim() && process.env["LOVABLE_API_KEY"]) {
    try {
      const res = await generateChatCompletion({
        model: "openai/gpt-6-astra",
        messages: [
          { role: "system", content: "Разбей Telegram-пост на 1–6 атомарных карточек ЧГК. Верни JSON {cards:[{term,hook,full_text,category_names}]}. Категории только из переданного списка, 1–3 штуки. Один факт — одна карточка." },
          { role: "user", content: `Категории: ${JSON.stringify(names)}\nПост:\n${text.slice(0, 6000)}` },
        ],
        response_format: { type: "json_object" },
      });
      const raw = JSON.parse(res.choices[0]?.message?.content ?? '{"cards":[]}') as any;
      cards = (Array.isArray(raw.cards) ? raw.cards : []).slice(0, 6).map((x: any) => ({
        term: String(x.term ?? "").trim(), hook: String(x.hook ?? "").trim(), full_text: String(x.full_text ?? text).trim(),
        category_names: Array.isArray(x.category_names) ? x.category_names.filter((n: string) => names.includes(n)).slice(0, 3) : [],
      })).filter((x: any) => x.term);
    } catch (e) { console.error("Telegram webhook AI failed", e); }
  }
  if (!cards.length) {
    cards = [{ term: text.split(/\n/)[0]?.slice(0, 200)?.trim() || "Без термина", hook: text.trim(), full_text: text.trim(), category_names: [] }];
  }

  const savedIds: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const channelIds = card.category_names.length
      ? (channels ?? []).filter((c: any) => card.category_names.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c: any) => c.id)
      : [channel.id];
    const tgId = cards.length === 1 ? post.message_id : post.message_id * 10 + i;
    const payload: any = {
      source_chat_id: String(chat.id), tg_message_id: tgId, term: card.term, hook: card.hook,
      full_text: card.full_text, channel_ids: [...new Set(channelIds)],
    };
    const { data } = await (supabaseAdmin as any).from("cards").upsert(payload, { onConflict: "source_chat_id,tg_message_id" }).select("id");
    if (data?.[0]?.id) savedIds.push(data[0].id);
  }

  if (channel.auto_edit_tg) {
    const firstCard = cards[0]!;
    const vars = { term: esc(firstCard.term), hook: esc(firstCard.hook), full_text: esc(cards.map((c) => c.full_text).join("\n\n")), categories: esc(cards.flatMap((c) => c.category_names).join(", ")) };
    let out = (channel.tg_post_template || "<b>{{term}}</b>").replace(/\{\{\s*(\w+)\s*\}\}/g, (_: string, k: string) => vars[k as keyof typeof vars] ?? "");
    out = cut(out, post.photo ? 1000 : 4000);
    const method = post.photo ? "editMessageCaption" : "editMessageText";
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post.photo ? { chat_id: chat.id, message_id: post.message_id, caption: out, parse_mode: "HTML" } : { chat_id: chat.id, message_id: post.message_id, text: out, parse_mode: "HTML" }),
    });
  }
  return Response.json({ ok: true, cards: savedIds.length });
}

export async function checkTelegramWebhook(url: string) {
  const token = await getBotToken();
  if (!token) return { ok: false, error: "Токен Telegram-бота не задан" };
  const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const setJson = await set.json() as any;
  if (!set.ok || setJson.ok === false) return { ok: false, error: setJson.description ?? `setWebhook: ${set.status}` };
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json() as any;
  const result = info.result ?? {};
  return {
    ok: info.ok === true,
    connected: info.ok === true && result.url === url,
    url: result.url,
    pending_update_count: result.pending_update_count,
    last_error_date: result.last_error_date,
    last_error_message: result.last_error_message ?? "",
  };
}
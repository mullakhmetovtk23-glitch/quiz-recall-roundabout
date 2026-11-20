import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const cut = (s: string,n: number) => Array.from(s).slice(0,n).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null,{headers:cors});
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const gemini = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!token) return new Response(JSON.stringify({error:"TELEGRAM_BOT_TOKEN missing"}),{status:500,headers:cors});

  const tg = await req.json();
  const update = tg.channel_post ?? tg.edited_channel_post;
  if (!update) return new Response("ok",{headers:cors});
  const chat = update.chat;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let { data: channel } = await supabase.from("channels").select("*").eq("tg_chat_id",String(chat.id)).maybeSingle();
  if (!channel) {
    const created = await supabase.from("channels").insert({name:chat.title ?? `Telegram ${chat.id}`,tg_chat_id:String(chat.id),color:"#2a9d8f"}).select("*").single();
    channel = created.data;
  }
  if (!channel) return new Response(JSON.stringify({error:"channel create failed"}),{status:500,headers:cors});

  const text = update.text ?? update.caption ?? "";
  const categories = (await supabase.from("channels").select("name").order("sort_order")).data?.map((x:{name:string})=>x.name) ?? [];
  let term=text.split(/\n/)[0]?.slice(0,200)?.trim()??"", hook=text.trim(), full_text=text.trim(), names:string[]=[];

  if (gemini && text) {
    const prompt=`Разметь пост для карточки ЧГК. Верни JSON: term, hook, full_text, category_names (1-3 из ${JSON.stringify(categories)}). ${channel.ai_prompt ?? ""}\nПост:\n${text.slice(0,6000)}`;
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${gemini}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});
    if (r.ok) { const j=await r.json(); const raw=j.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).join("") ?? "{}"; try { const x=JSON.parse(raw); term=x.term||term; hook=x.hook||hook; full_text=x.full_text||full_text; names=Array.isArray(x.category_names)?x.category_names:[]; } catch {} }
  }
  const ids=categories.map((n,i)=>n).length ? (await supabase.from("channels").select("id,name")).data?.filter((c:any)=>names.map((n:string)=>n.toLowerCase()).includes(c.name.toLowerCase())).map((c:any)=>c.id) ?? [channel.id] : [channel.id];

  await supabase.from("cards").upsert({source_chat_id:String(chat.id),tg_message_id:update.message_id,term,hook,full_text,channel_ids:[...new Set(ids)]},{onConflict:"source_chat_id,tg_message_id"});

  if (channel.auto_edit_tg) {
    const vars={term:esc(term),hook:esc(hook),full_text:esc(full_text),categories:esc(names.join(", "))};
    let out=(channel.tg_post_template||"<b>{{term}}</b>").replace(/\{\{\s*(\w+)\s*\}\}/g,(_:string,k:string)=>vars[k as keyof typeof vars]??"");
    const limit=update.photo||update.photo?.length ? 1000 : 4000; out=cut(out,limit);
    const method=update.photo ? "editMessageCaption" : "editMessageText";
    await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(update.photo?{chat_id:chat.id,message_id:update.message_id,caption:out,parse_mode:"HTML"}:{chat_id:chat.id,message_id:update.message_id,text:out,parse_mode:"HTML"})});
  }
  return new Response(JSON.stringify({ok:true}),{headers:cors});
});

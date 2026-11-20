import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound, Monitor, Moon, Plus, Sun, Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SectionTitle } from "@/components/OptionCard";
import { supabase } from "@/integrations/supabase/client";
import { channelsQuery, statsQuery, type Channel } from "@/lib/db";
import { useSettings, type ThemePref } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Статистика и настройки — Бинго-тренер" },
      { name: "description", content: "Сколько карточек к повторению по каждому каналу, управление каналами и ключ ИИ." },
      { property: "og:title", content: "Статистика и настройки — Бинго-тренер" },
      { property: "og:description", content: "Прогресс по каналам и настройки тренажёра." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(channelsQuery),
      context.queryClient.ensureQueryData(statsQuery),
    ]),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: channels } = useSuspenseQuery(channelsQuery);
  const { data: stats } = useSuspenseQuery(statsQuery);
  const statFor = (id: string | null) => stats.find((s) => s.channel_id === id);
  const totalDue = stats.reduce((n, s) => n + s.due_forward + s.due_reverse, 0);
  const totalCards = stats.reduce((n, s) => n + s.total, 0);
  const orphan = statFor(null);

  return (
    <div className="space-y-10 animate-card-in">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">Статистика и настройки</h1>
      </div>

      <section>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="index-card px-4 py-4">
            <div className="font-display text-3xl font-semibold tabular-nums text-primary">{totalDue}</div>
            <div className="text-xs text-muted-foreground">к повторению сегодня</div>
          </div>
          <div className="index-card px-4 py-4">
            <div className="font-display text-3xl font-semibold tabular-nums">{totalCards}</div>
            <div className="text-xs text-muted-foreground">карточек всего</div>
          </div>
        </div>
        <SectionTitle aside={<span className="text-xs text-muted-foreground">прямое · обратное</span>}>К повторению по каналам</SectionTitle>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {[...channels.map((c) => ({ id: c.id as string | null, name: c.name, color: c.color })), ...(orphan ? [{ id: null, name: "Без канала", color: "var(--box-new)" }] : [])].map((c) => {
            const s = statFor(c.id);
            const due = (s?.due_forward ?? 0) + (s?.due_reverse ?? 0);
            return (
              <li key={c.id ?? "none"} className="flex items-center gap-3 px-4 py-3">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s?.due_forward ?? 0} · {s?.due_reverse ?? 0}
                </span>
                <span className={cn("min-w-10 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums", due ? "bg-primary/12 text-primary" : "bg-secondary text-muted-foreground")}>
                  {due}
                </span>
                <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">из {s?.total ?? 0}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <ChannelsManager channels={channels} />
      <AiSettings />
      <TelegramWebhookSettings />
      <ThemeSettings />
    </div>
  );
}

function ChannelsManager({ channels }: { channels: Channel[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2a9d8f");
  const [toDelete, setToDelete] = useState<Channel | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["channels"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
  };

  async function create() {
    const n = name.trim();
    if (!n) return;
    const { error } = await supabase
      .from("channels")
      .insert({ name: n, color, sort_order: (channels.at(-1)?.sort_order ?? 0) + 1 });
    if (error) {
      toast.error(error.code === "23505" ? "Такой канал уже есть" : "Не удалось создать канал");
      return;
    }
    setName("");
    refresh();
  }

  async function patch(id: string, values: Partial<Pick<Channel, "name" | "color" | "tg_chat_id" | "description" | "icon" | "ai_prompt" | "auto_edit_tg" | "tg_post_template" | "sort_order">>) {
    const { error } = await supabase.from("channels").update(values).eq("id", id);
    if (error) toast.error(error.code === "23505" ? "Такой канал уже есть" : "Не удалось сохранить");
    refresh();
  }

  async function remove() {
    const ch = toDelete;
    setToDelete(null);
    if (!ch) return;
    const { error } = await supabase.from("channels").delete().eq("id", ch.id);
    if (error) toast.error("Не удалось удалить канал");
    refresh();
  }

  return (
    <section>
      <SectionTitle>Каналы</SectionTitle>
      <ul className="space-y-2">
        {channels.map((c) => (
          <ChannelRow key={c.id} channel={c} onPatch={(v) => void patch(c.id, v)} onDelete={() => setToDelete(c)} />
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-border bg-card p-1" aria-label="Цвет" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый канал" className="h-11 rounded-xl bg-card" />
        <Button type="submit" className="h-11 rounded-xl" disabled={!name.trim()}>
          <Plus /> Создать
        </Button>
      </form>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить канал «{toDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Карточки останутся в базе, но станут «Без канала».</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ChannelRow({ channel, onPatch, onDelete }: { channel: Channel; onPatch: (v: Partial<Pick<Channel, "name" | "color">>) => void; onDelete: () => void }) {
  const [name, setName] = useState(channel.name);
  const [color, setColor] = useState(channel.color);
  useEffect(() => {
    setName(channel.name);
    setColor(channel.color);
  }, [channel.name, channel.color]);

  return (
    <li className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        onBlur={() => color !== channel.color && onPatch({ color })}
        className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-border bg-card p-1"
        aria-label={`Цвет канала ${channel.name}`}
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim();
          if (!n) setName(channel.name);
          else if (n !== channel.name) onPatch({ name: n });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-11 rounded-xl bg-card"
        aria-label="Название канала"
      />
      <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Удалить канал">
        <Trash2 />
      </Button>
    </li>
  );
}

function TelegramWebhookSettings() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Не проверено");
  const [loading, setLoading] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/telegram-webhook` : "/api/telegram-webhook";

  useEffect(() => {
    void supabase.from("app_settings").select("value").eq("key", "telegram_bot_token").maybeSingle()
      .then(({ data }) => setToken(data?.value ?? ""));
  }, []);

  async function saveToken() {
    const value = token.trim();
    if (!value) {
      toast.error("Введите токен бота");
      return false;
    }
    const { error } = await supabase.from("app_settings").upsert({
      key: "telegram_bot_token",
      value,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("Токен бота сохранён");
    return true;
  }

  async function connect() {
    setLoading(true);
    try {
      if (!(await saveToken())) return;
      const res = await fetch("/api/telegram-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkTelegramWebhook", url }),
      });
      const info = await res.json() as any;
      if (!res.ok || !info.ok) throw new Error(info.error ?? "Ошибка проверки вебхука");
      if (info.connected) {
        setStatus(info.last_error_message
          ? `Подключено, последняя ошибка: ${info.last_error_message}`
          : `Подключено · ожидание обновлений: ${info.pending_update_count ?? 0}`);
      } else {
        setStatus(`Вебхук не совпадает с URL: ${info.url || "пусто"}`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Не удалось проверить вебхук");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <SectionTitle>Синхронизация с Telegram-ботом</SectionTitle>
      <div className="index-card space-y-3 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="telegram-bot-token">Токен бота</Label>
          <Input id="telegram-bot-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA..." className="h-11 rounded-xl" />
        </div>
        <p className="text-xs text-muted-foreground">URL вебхука приложения</p>
        <code className="block break-all rounded-xl bg-secondary p-3 text-xs">{url}</code>
        <p className="text-sm">Статус: <b>{status}</b></p>
        <Button className="h-11 rounded-xl" disabled={loading} onClick={() => void connect()}>
          <Wifi /> Подключить / Проверить вебхук
        </Button>
      </div>
    </section>
  );
}

function AiSettings() {
  const { settings, save } = useSettings();
  const [baseUrl, setBaseUrl] = useState(settings.llmBaseUrl);
  const [model, setModel] = useState(settings.llmModel);
  const [key, setKey] = useState(settings.llmApiKey);
  useEffect(() => {
    setBaseUrl(settings.llmBaseUrl);
    setModel(settings.llmModel);
    setKey(settings.llmApiKey);
  }, [settings.llmBaseUrl, settings.llmModel, settings.llmApiKey]);

  return (
    <section>
      <SectionTitle>ИИ для авторазметки</SectionTitle>
      <div className="index-card space-y-4 p-5">
        <p className="text-sm text-muted-foreground">
          По умолчанию импорт размечает встроенный ИИ — ключ не нужен. Если хотите использовать свой
          OpenAI-совместимый API, укажите ключ: он хранится только в этом браузере.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="llm-url">Адрес API</Label>
            <Input id="llm-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llm-model">Модель</Label>
            <Input id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} className="h-11 rounded-xl" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="llm-key">Ключ API</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="llm-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" className="h-11 rounded-xl pl-10" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-11 rounded-xl"
            onClick={() => {
              save({ llmBaseUrl: baseUrl.trim(), llmModel: model.trim(), llmApiKey: key.trim() });
              toast.success(key.trim() ? "Свой ключ сохранён" : "Сохранено");
            }}
          >
            Сохранить
          </Button>
          {settings.llmApiKey && (
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => {
                save({ llmApiKey: "" });
                toast.success("Ключ удалён — снова работает встроенный ИИ");
              }}
            >
              Удалить ключ
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Сейчас: {settings.llmApiKey ? `ваш ключ (${settings.llmModel})` : "встроенный ИИ"}
        </p>
      </div>
    </section>
  );
}

function ThemeSettings() {
  const { settings, save } = useSettings();
  const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: "system", label: "Как в системе", icon: Monitor },
    { value: "light", label: "Светлая", icon: Sun },
    { value: "dark", label: "Тёмная", icon: Moon },
  ];
  return (
    <section>
      <SectionTitle>Оформление</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => save({ theme: value })}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-medium transition-all",
              settings.theme === value ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card hover:bg-secondary",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

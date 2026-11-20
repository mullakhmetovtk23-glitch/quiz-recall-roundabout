import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, CalendarCheck, Check, Infinity as InfinityIcon, Loader2, Pencil, Shuffle, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChannelPill } from "@/components/ChannelPill";
import { CardFormDialog } from "@/components/CardFormDialog";
import { OptionCard, SectionTitle } from "@/components/OptionCard";
import { supabase } from "@/integrations/supabase/client";
import { CARD_COLUMNS, channelsQuery, fetchAllPages, statsQuery, type Card, type Channel } from "@/lib/db";
import { GRADES, nextReview, type Grade } from "@/lib/leitner";
import { buildSession, type DirectionMode, type SessionItem } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Тренировка — Бинго-тренер" },
      { name: "description", content: "Соберите сессию повторения: каналы, направление карточек и режим — и тренируйтесь по системе Лейтнера." },
      { property: "og:title", content: "Тренировка — Бинго-тренер" },
      { property: "og:description", content: "Интервальное повторение фактов для ЧГК и Своей игры." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(channelsQuery),
      context.queryClient.ensureQueryData(statsQuery),
    ]),
  component: TrainingPage,
});

interface SessionConfig {
  allChannels: boolean;
  channelIds: string[];
  mode: DirectionMode;
  dueOnly: boolean;
}

const CONFIG_KEY = "bingo-trainer-session";
const DEFAULT_CONFIG: SessionConfig = { allChannels: true, channelIds: [], mode: "reverse", dueOnly: true };
type Counts = Record<Grade, number>;
const EMPTY_COUNTS: Counts = { 1: 0, 2: 0, 3: 0, 4: 0 };

function TrainingPage() {
  const { data: channels } = useSuspenseQuery(channelsQuery);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"setup" | "play" | "done">("setup");
  const [queue, setQueue] = useState<SessionItem[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);

  return phase === "play" ? (
    <Player
      initial={queue}
      channels={channels}
      onExit={(c) => {
        setCounts(c);
        setPhase("done");
        void qc.invalidateQueries({ queryKey: ["stats"] });
      }}
    />
  ) : phase === "done" ? (
    <DoneScreen counts={counts} onAgain={() => setPhase("setup")} />
  ) : (
    <SetupScreen
      channels={channels}
      onStart={(items) => {
        setQueue(items);
        setPhase("play");
      }}
    />
  );
}

/* ───────────────────────── Setup ───────────────────────── */

function SetupScreen({ channels, onStart }: { channels: Channel[]; onStart: (items: SessionItem[]) => void }) {
  const { data: stats } = useSuspenseQuery(statsQuery);
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) setConfig({ ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<SessionConfig>) });
    } catch {
      /* ignore */
    }
  }, []);
  const update = (patch: Partial<SessionConfig>) =>
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      return next;
    });

  const statFor = (id: string | null) => stats.find((s) => s.channel_id === id);
  const dueOf = (id: string | null) => {
    const s = statFor(id);
    if (!s) return 0;
    return config.mode === "forward" ? s.due_forward : config.mode === "reverse" ? s.due_reverse : s.due_forward + s.due_reverse;
  };
  const selectedStats = config.allChannels ? stats : stats.filter((s) => s.channel_id && config.channelIds.includes(s.channel_id));
  const plannedCount = config.dueOnly
    ? selectedStats.reduce((n, s) => n + (config.mode === "forward" ? s.due_forward : config.mode === "reverse" ? s.due_reverse : s.due_forward + s.due_reverse), 0)
    : selectedStats.reduce((n, s) => n + s.total, 0);
  const totalDueToday = stats.reduce((n, s) => n + s.due_forward + s.due_reverse, 0);

  function toggleChannel(id: string) {
    if (config.allChannels) return update({ allChannels: false, channelIds: [id] });
    const ids = config.channelIds.includes(id) ? config.channelIds.filter((x) => x !== id) : [...config.channelIds, id];
    update(ids.length ? { channelIds: ids } : { allChannels: true, channelIds: [] });
  }

  async function start() {
    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const cards = await fetchAllPages<Card>((from, to) => {
        let q = supabase.from("cards").select(CARD_COLUMNS);
        if (!config.allChannels) q = q.overlaps("channel_ids", config.channelIds);
        if (config.dueOnly) {
          if (config.mode === "forward") q = q.lte("fwd_due_at", nowIso);
          else if (config.mode === "reverse") q = q.lte("rev_due_at", nowIso);
          else q = q.or(`fwd_due_at.lte."${nowIso}",rev_due_at.lte."${nowIso}"`);
        }
        return q.order("id").range(from, to);
      });
      const items = buildSession(cards, config.mode, config.dueOnly);
      if (!items.length) {
        toast.info(config.dueOnly ? "На сегодня всё повторено 🎉 Попробуйте свободную тренировку." : "В выбранных каналах пока нет карточек.");
        return;
      }
      onStart(items);
    } catch (e) {
      console.error(e);
      toast.error("Не удалось загрузить карточки");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 animate-card-in">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">Тренировка</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Сегодня к повторению: <span className="font-semibold text-foreground">{totalDueToday}</span>
        </p>
      </div>

      <section>
        <SectionTitle>Источники</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <ChannelChip
            active={config.allChannels}
            onClick={() => update({ allChannels: true, channelIds: [] })}
            label="Все каналы"
            count={stats.reduce((n, s) => n + dueOf(s.channel_id), 0)}
          />
          {channels.map((c) => (
            <ChannelChip
              key={c.id}
              active={!config.allChannels && config.channelIds.includes(c.id)}
              onClick={() => toggleChannel(c.id)}
              label={c.name}
              color={c.color}
              count={dueOf(c.id)}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Направление карточек</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          <OptionCard active={config.mode === "reverse"} onClick={() => update({ mode: "reverse" })} icon={<Undo2 className="size-5" />} title="Обратное" description="Крючок → Термин" />
          <OptionCard active={config.mode === "forward"} onClick={() => update({ mode: "forward" })} icon={<ArrowRight className="size-5" />} title="Прямое" description="Термин → Факты" />
          <OptionCard active={config.mode === "mixed"} onClick={() => update({ mode: "mixed" })} icon={<Shuffle className="size-5" />} title="Вперемешку" description="Оба направления" />
        </div>
      </section>

      <section>
        <SectionTitle>Режим</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          <OptionCard active={config.dueOnly} onClick={() => update({ dueOnly: true })} icon={<CalendarCheck className="size-5" />} title="Только к повторению на сегодня" description="Карточки, у которых подошёл срок" />
          <OptionCard active={!config.dueOnly} onClick={() => update({ dueOnly: false })} icon={<InfinityIcon className="size-5" />} title="Свободная тренировка" description="Все карточки выбранных каналов" />
        </div>
      </section>

      <div className="sticky bottom-24 z-10 md:bottom-6">
        <Button size="xl" className="w-full shadow-lift" onClick={() => void start()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />}
          Начать{plannedCount > 0 ? ` · ${plannedCount}` : ""}
        </Button>
      </div>
    </div>
  );
}

function ChannelChip({ active, onClick, label, color, count }: { active: boolean; onClick: () => void; label: string; color?: string; count: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-all active:scale-[0.97]",
        active ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card hover:bg-secondary",
      )}
    >
      <span className={cn("grid size-4 place-items-center rounded-[5px] border-2", active ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
        {active && <Check className="size-2.5" strokeWidth={3.5} />}
      </span>
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
      {count > 0 && <span className="rounded-full bg-primary/12 px-1.5 text-xs font-semibold text-primary">{count}</span>}
    </button>
  );
}

/* ───────────────────────── Player ───────────────────────── */

function Player({ initial, channels, onExit }: { initial: SessionItem[]; channels: Channel[]; onExit: (counts: Counts) => void }) {
  const [queue, setQueue] = useState<SessionItem[]>(initial);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const requeueSeq = useRef(0);
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const item = queue[index];

  useEffect(() => {
    if (index >= queue.length) onExit(counts);
  }, [index, queue.length, counts, onExit]);

  const grade = useCallback(
    (g: Grade) => {
      if (!item || !flipped) return;
      const forward = item.direction === "forward";
      const r = nextReview(forward ? item.card.fwd_box : item.card.rev_box, g);
      const nowIso = new Date().toISOString();
      const patch = forward
        ? { fwd_box: r.box, fwd_due_at: r.dueAt.toISOString(), fwd_reviewed_at: nowIso }
        : { rev_box: r.box, rev_due_at: r.dueAt.toISOString(), rev_reviewed_at: nowIso };
      const updated: Card = { ...item.card, ...patch };
      setQueue((prev) => {
        const next = prev.map((it) => (it.card.id === updated.id ? { ...it, card: updated } : it));
        if (r.requeue) next.push({ ...item, card: updated, key: `${item.key}:again${++requeueSeq.current}` });
        return next;
      });
      setCounts((c) => ({ ...c, [g]: c[g] + 1 }));
      setFlipped(false);
      setIndex((i) => i + 1);
      void supabase
        .from("cards")
        .update(patch)
        .eq("id", item.card.id)
        .then(({ error }) => {
          if (error) toast.error("Не удалось сохранить прогресс карточки");
        });
    },
    [item, flipped],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        grade(Number(e.key) as Grade);
      } else if (e.code === "KeyE") {
        e.preventDefault();
        setEditOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [grade, editOpen]);

  if (!item) return null;
  const card = item.card;
  const reverse = item.direction === "reverse";
  const showImage = !!card.image_url && (reverse || flipped);
  const done = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex min-h-[calc(100vh-11rem)] flex-col gap-4 md:min-h-[calc(100vh-6rem)]">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => onExit(counts)} aria-label="Завершить сессию">
          <X />
        </Button>
        <Progress value={(index / queue.length) * 100} className="h-2 flex-1" />
        <span className="min-w-14 text-right text-sm tabular-nums text-muted-foreground">
          {index + 1} / {queue.length}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} aria-label="Редактировать (E)" title="Редактировать (E)">
          <Pencil />
        </Button>
      </div>

      <div
        key={item.key}
        role="button"
        tabIndex={-1}
        onClick={() => !flipped && setFlipped(true)}
        className={cn("index-card flex flex-1 flex-col overflow-hidden animate-card-in", !flipped && "cursor-pointer")}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {card.channel_ids.length ? (
              card.channel_ids.map((id) => <ChannelPill key={id} channel={channelMap.get(id)} />)
            ) : (
              <ChannelPill channel={null} />
            )}
          </div>
          <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", reverse ? "bg-primary/12 text-primary" : "bg-grade-good/15 text-grade-good")}>
            {reverse ? "Угадай термин" : "Вспомни факты"}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
          {showImage && (
            <img src={card.image_url!} alt="" className="max-h-64 w-full rounded-xl bg-muted object-contain md:max-h-80" />
          )}

          {!flipped ? (
            <div className="my-auto text-center">
              {reverse ? (
                <>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Крючок</div>
                  <p className="text-xl leading-relaxed md:text-2xl">
                    {card.hook || <span className="text-muted-foreground">Крючок не заполнен — нажмите E, чтобы добавить</span>}
                  </p>
                </>
              ) : (
                <p className="font-display text-3xl font-semibold leading-tight md:text-4xl">{card.term || "—"}</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 animate-flip-in">
              <p className="font-display text-2xl font-semibold leading-tight md:text-3xl">{card.term || "—"}</p>
              {card.hook && <p className="border-l-2 border-primary pl-3 text-base italic text-ink-soft">{card.hook}</p>}
              {card.full_text && (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/85">{card.full_text}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-20 z-10 md:bottom-4">
        {!flipped ? (
          <Button size="xl" variant="secondary" className="w-full border border-border shadow-card" onClick={() => setFlipped(true)}>
            Показать ответ <span className="kbd hidden md:inline-flex">Space</span>
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {GRADES.map(({ grade: g, label, hint }) => (
              <Button
                key={g}
                size="thumb"
                variant={g === 1 ? "again" : g === 2 ? "hard" : g === 3 ? "good" : "easy"}
                onClick={() => grade(g)}
              >
                <span className="flex items-center gap-1.5">
                  <span className="kbd hidden md:inline-flex">{g}</span>
                  {label}
                </span>
                <span className="text-[11px] font-normal opacity-80">
                  {g === 4 ? ((reverse ? card.rev_box : card.fwd_box) >= 3 ? "45 дней" : "14 дней") : hint}
                </span>
              </Button>
            ))}
          </div>
        )}
        <p className="mt-2 text-center text-xs text-muted-foreground">Отвечено: {done}</p>
      </div>

      <CardFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        channels={channels}
        card={card}
        onSaved={(saved) => setQueue((prev) => prev.map((it) => (it.card.id === saved.id ? { ...it, card: saved } : it)))}
      />
    </div>
  );
}

/* ───────────────────────── Done ───────────────────────── */

function DoneScreen({ counts, onAgain }: { counts: Counts; onAgain: () => void }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tone = ["bg-grade-again", "bg-grade-hard", "bg-grade-good", "bg-grade-easy"];
  return (
    <div className="index-card mx-auto max-w-md space-y-6 p-6 text-center animate-card-in md:p-8">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Check className="size-7" strokeWidth={3} />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Сессия завершена</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ответов: {total}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-left">
        {GRADES.map(({ grade: g, label }, i) => (
          <div key={g} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
            <span className={cn("size-2.5 rounded-full", tone[i])} />
            <span className="flex-1 text-sm">{label}</span>
            <span className="font-semibold tabular-nums">{counts[g]}</span>
          </div>
        ))}
      </div>
      <Button size="xl" className="w-full" onClick={onAgain}>
        Новая сессия
      </Button>
    </div>
  );
}

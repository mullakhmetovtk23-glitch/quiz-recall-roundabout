import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Download, ImageIcon, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { CardFormDialog } from "@/components/CardFormDialog";
import { ChannelPill } from "@/components/ChannelPill";
import { BoxLegend, ProgressDots } from "@/components/ProgressDots";
import { supabase } from "@/integrations/supabase/client";
import { CARD_COLUMNS, buildTsQuery, channelsQuery, type Card } from "@/lib/db";
import { removeCardImage } from "@/lib/storage";
import { RelatedCardsSection } from "@/components/RelatedCardsSection";
import { findRelatedCards } from "@/lib/related-cards";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "База знаний — Бинго-тренер" },
      { name: "description", content: "Поиск по всем карточкам, фильтр по каналам, добавление и удаление фактов." },
      { property: "og:title", content: "База знаний — Бинго-тренер" },
      { property: "og:description", content: "Все ваши карточки с фактами в одном месте." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(channelsQuery),
  component: LibraryPage,
});

const ALL = "__all__";
const NONE = "__none__";
const PAGE = 50;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function LibraryPage() {
  const { data: channels } = useSuspenseQuery(channelsQuery);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState(ALL);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Card | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Card | null>(null);
  const [cardHistory, setCardHistory] = useState<Card[]>([]);
  const q = useDebounced(search.trim(), 300);
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  useEffect(() => setLimit(PAGE), [q, channel]);

  const cardsQuery = useQuery({
    queryKey: ["cards", { q, channel, limit }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase.from("cards").select(CARD_COLUMNS, { count: "exact" });
      const ts = buildTsQuery(q);
      if (ts) query = query.textSearch("search_vector", ts, { config: "russian" });
      if (channel === NONE) query = (query as any).eq("channel_ids", "{}");
      else if (channel !== ALL) query = query.contains("channel_ids", [channel]);
      const { data, error, count } = await query.order("created_at", { ascending: false }).range(0, limit - 1);
      if (error) throw error;
      return { cards: data, count: count ?? data.length };
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["cards"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
  };

  async function confirmDelete() {
    const card = toDelete;
    if (!card) return;
    setToDelete(null);
    const { error } = await supabase.from("cards").delete().eq("id", card.id);
    if (error) {
      toast.error("Не удалось удалить карточку");
      return;
    }
    void removeCardImage(card.image_url);
    toast.success("Карточка удалена");
    invalidate();
  }

  const cards = cardsQuery.data?.cards ?? [];
  const count = cardsQuery.data?.count ?? 0;

  return (
    <div className="space-y-5 animate-card-in">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">База знаний</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {cardsQuery.isPending ? "Загрузка…" : `Карточек: ${count}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to="/import">
            <Button variant="outline" size="lg" className="h-11 rounded-xl px-3">
              <Download /> <span className="hidden sm:inline">Импорт из Telegram (JSON)</span>
            </Button>
          </Link>
          <Button
            size="lg"
            className="h-11 rounded-xl px-4"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> <span className="hidden sm:inline">Добавить</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по термину, крючку и тексту"
            className="h-11 rounded-xl bg-card pl-10"
          />
          {cardsQuery.isFetching && (
            <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-11 rounded-xl bg-card sm:w-60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все каналы</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
            <SelectItem value={NONE}>Без канала</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <BoxLegend />

      {cardsQuery.isError ? (
        <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">Не удалось загрузить карточки.</p>
      ) : !cardsQuery.isPending && cards.length === 0 ? (
        <div className="index-card px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold">{q ? "Ничего не нашлось" : "Здесь пока пусто"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? "Попробуйте другое слово." : "Добавьте карточку вручную или импортируйте канал из Telegram."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {cards.map((card) => (
            <li key={card.id} className="flex items-start gap-3 px-4 py-3.5">
              <div className="pt-1.5"><ProgressDots card={card} /></div>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setCardHistory([]);
                  setEditing(card);
                  setFormOpen(true);
                }}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{card.term || "Без термина"}</span>
                  {card.image_url && <ImageIcon className="size-3.5 text-muted-foreground" />}
                </div>
                {card.hook && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{card.hook}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(card.channel_ids ?? []).length ? (
                    (card.channel_ids ?? []).map((id) => <ChannelPill key={id} channel={channelMap.get(id)} />)
                  ) : (
                    <ChannelPill channel={null} />
                  )}
                </div>
              </button>
              {card.image_url && (
                <img src={card.image_url} alt="" className="hidden size-14 shrink-0 rounded-lg bg-muted object-cover sm:block" loading="lazy" />
              )}
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Редактировать"
                  onClick={() => {
                    setCardHistory([]);
                    setEditing(card);
                    setFormOpen(true);
                  }}
                >
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Удалить" onClick={() => setToDelete(card)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cards.length < count && (
        <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setLimit((l) => l + PAGE)}>
          Показать ещё
        </Button>
      )}

      <CardFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        channels={channels}
        card={editing}
        defaultChannelId={channel !== ALL && channel !== NONE ? channel : null}
        onSaved={invalidate}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить карточку?</AlertDialogTitle>
            <AlertDialogDescription>«{toDelete?.term}» и её прогресс будут удалены безвозвратно.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

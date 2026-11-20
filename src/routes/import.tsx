import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, Image as ImageIcon, Pause, Play, Sparkles, Square, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OptionCard, SectionTitle } from "@/components/OptionCard";
import { supabase } from "@/integrations/supabase/client";
import { labelPostBatch, type AtomicCardLabel } from "@/lib/ai.functions";
import { channelsQuery, fetchAllPages } from "@/lib/db";
import { labelPostBatchWithOwnKey } from "@/lib/labeler";
import { useSettings } from "@/lib/settings";
import { uploadCardImage } from "@/lib/storage";
import { buildPhotoMap, parseTelegramExport, type ParsedExport, type ParsedPost } from "@/lib/telegram";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Импорт из Telegram — Бинго-тренер" },
      { name: "description", content: "Загрузите экспорт канала из Telegram Desktop — ИИ превратит посты в карточки с термином и крючком." },
      { property: "og:title", content: "Импорт из Telegram — Бинго-тренер" },
      { property: "og:description", content: "Посты из Telegram превращаются в карточки для повторения." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(channelsQuery),
  component: ImportPage,
});

type RunStatus = "idle" | "running" | "paused" | "done" | "cancelled";
type Outcome = "added" | "skipped" | "failed" | "retry";
const BATCH_SIZE = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ImportPage() {
  const { data: channels } = useSuspenseQuery(channelsQuery);
  const qc = useQueryClient();
  const { settings } = useSettings();
  const labelBatchFn = useServerFn(labelPostBatch);

  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [photos, setPhotos] = useState<Map<string, File>>(new Map());
  const [sourceLabel, setSourceLabel] = useState("");
  const [destination, setDestination] = useState<"channel" | "ai">("ai");
  const [targetChannel, setTargetChannel] = useState<string>("");
  const [skipExisting, setSkipExisting] = useState(true);

  const [status, setStatus] = useState<RunStatus>("idle");
  const [progress, setProgress] = useState({ processed: 0, total: 0, created: 0, added: 0, skipped: 0, failed: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [cleanupCount, setCleanupCount] = useState<number | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);
  useEffect(() => {
    if (!targetChannel && channels[0]) setTargetChannel(channels[0].id);
  }, [channels, targetChannel]);

  const busy = status === "running" || status === "paused";

  async function loadJson(file: File, photoMap: Map<string, File>, label: string) {
    try {
      const result = parseTelegramExport(JSON.parse(await file.text()));
      setParsed(result);
      setPhotos(photoMap);
      setSourceLabel(label);
      setStatus("idle");
      setProgress({ processed: 0, total: result.posts.length, created: 0, added: 0, skipped: 0, failed: 0 });
      setErrors([]);
      setNotice(null);
    } catch (e) {
      setParsed(null);
      toast.error(e instanceof Error ? e.message : "Не удалось прочитать файл");
    }
  }

  async function onPickFolder(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const { resultFile, photos: map } = buildPhotoMap(files);
    if (!resultFile) {
      toast.error("В папке не найден result.json");
      return;
    }
    const folder = (resultFile.webkitRelativePath || "").split("/")[0] || "папка";
    await loadJson(resultFile, map, `Папка «${folder}»`);
  }

  const withPhoto = parsed?.posts.filter((p) => p.photo).length ?? 0;
  const photosFound = parsed?.posts.filter((p) => p.photo && photos.has(p.photo)).length ?? 0;

  async function processBatch(posts: ParsedPost[], chatId: string, existing: Set<number>, byName: Map<string, string>): Promise<{ outcomes: Map<number, Outcome>; created: number }> {
    const candidates = posts.filter((p) => {
      const clean = p.text?.replace(/\s+/g, " ").trim() ?? "";
      const noise = /^\s*(joined|added|pinned|left|service|подключ|присоедини)/i.test(clean);
      return clean.length >= 40 && !noise && (!skipExisting || !existing.has(p.tgMessageId));
    });
    const outcomes = new Map<number, Outcome>();
    posts.forEach((p) => outcomes.set(p.tgMessageId, skipExisting && existing.has(p.tgMessageId) ? "skipped" : "failed"));
    if (!candidates.length) return { outcomes, created: 0 };

    const aiPosts = candidates.map((p) => ({ id: p.tgMessageId, text: p.text.slice(0, 4000) }));
    const categories = destination === "ai" ? channels.map((c) => c.name) : [];
    const res = settings.llmApiKey
      ? await labelPostBatchWithOwnKey(aiPosts, categories, settings)
      : await labelBatchFn({ data: { posts: aiPosts, categories } });

    if (!res.ok) {
      pauseRef.current = true;
      setStatus("paused");
      setNotice(res.error);
      return { outcomes, created: 0 };
    }

    let created = 0;
    for (const post of candidates) {
      const cards: AtomicCardLabel[] = res.items[post.tgMessageId] ?? [];
      if (!cards.length) {
        setErrors((e) => [`Пост №${post.tgMessageId}: ИИ не вернул карточки`, ...e].slice(0, 30));
        outcomes.set(post.tgMessageId, "failed");
        continue;
      }

      let image_url: string | null = null;
      const photoFile = post.photo ? photos.get(post.photo) : undefined;
      if (photoFile) {
        try { image_url = await uploadCardImage(photoFile, photoFile.name, `tg/${chatId.replace(/[^\w-]/g, "_")}`); }
        catch { setErrors((e) => [`Пост №${post.tgMessageId}: картинка не загрузилась`, ...e].slice(0, 30)); }
      }

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]!;
        const channelIds = destination === "channel" && targetChannel
          ? [targetChannel]
          : card.category_names.map((n) => byName.get(n.toLowerCase())).filter((id): id is string => !!id);
        const tgId = i === 0 ? post.tgMessageId : post.tgMessageId * 100 + i;
        const { error } = await supabase.from("cards").upsert({
          source_chat_id: chatId,
          tg_message_id: tgId,
          term: card.term,
          hook: card.hook,
          full_text: card.full_text,
          image_url: i === 0 ? image_url : null,
          channel_ids: channelIds,
        }, { onConflict: "source_chat_id,tg_message_id" });
        if (error) {
          setErrors((e) => [`Пост №${post.tgMessageId}: карточка ${i + 1} не сохранилась`, ...e].slice(0, 30));
          outcomes.set(post.tgMessageId, "failed");
          continue;
        }
        created++;
        outcomes.set(post.tgMessageId, "added");
      }
    }
    return { outcomes, created };
  }

  async function run() {
    if (!parsed) return;
    if (destination === "channel" && !targetChannel) {
      toast.error("Выберите канал");
      return;
    }
    cancelRef.current = false;
    pauseRef.current = false;
    setNotice(null);
    setErrors([]);
    setStatus("running");
    const posts = parsed.posts;
    setProgress({ processed: 0, total: posts.length, created: 0, added: 0, skipped: 0, failed: 0 });

    let existing = new Set<number>();
    try {
      if (skipExisting) {
        const rows = await fetchAllPages<{ tg_message_id: number | null }>((from, to) =>
          supabase.from("cards").select("tg_message_id").eq("source_chat_id", parsed.chatId).order("id").range(from, to),
        );
        existing = new Set(rows.map((r) => r.tg_message_id).filter((x): x is number => x != null));
      }
    } catch {
      toast.error("Не удалось проверить уже импортированные посты");
      setStatus("idle");
      return;
    }
    const byName = new Map(channels.map((c) => [c.name.toLowerCase(), c.id]));

    const batchCount = Math.ceil(posts.length / BATCH_SIZE);
    for (let batch = 0; batch < batchCount && !cancelRef.current; batch++) {
      while (pauseRef.current && !cancelRef.current) await sleep(250);
      if (cancelRef.current) break;
      setNotice(`Батч ${batch + 1} из ${batchCount}`);
      const slice = posts.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

      let result = await processBatch(slice, parsed.chatId, existing, byName);
      if (pauseRef.current) {
        if (/HTTP 429|429|rate.?limit/i.test(notice ?? "")) {
          setNotice(`${notice ?? "HTTP 429: лимит провайдера ИИ"}. Повтор через 20 секунд.`);
          await sleep(20000);
          if (!cancelRef.current) {
            pauseRef.current = false;
            setStatus("running");
            setNotice(null);
            let retries = 0;
            do {
              result = await processBatch(slice, parsed.chatId, existing, byName);
              retries++;
              if (pauseRef.current && /HTTP 429|429|rate.?limit/i.test(notice ?? "") && retries < 5) {
                setNotice(`${notice}. Повтор через 20 секунд.`);
                await sleep(20000);
              } else {
                break;
              }
            } while (!cancelRef.current);
          }
        }
      }

      if (!pauseRef.current && !cancelRef.current && batch < batchCount - 1) {
        await sleep(6500);
      }

      let added = 0, skipped = 0, failed = 0;
      result.outcomes.forEach((outcome) => {
        if (outcome === "added") added++;
        if (outcome === "skipped") skipped++;
        if (outcome === "failed") failed++;
      });
      setProgress((p) => ({
        ...p,
        processed: p.processed + slice.length,
        created: p.created + result.created,
        added: p.added + added,
        skipped: p.skipped + skipped,
        failed: p.failed + failed,
      }));
    }
    setStatus(cancelRef.current ? "cancelled" : "done");
    void qc.invalidateQueries({ queryKey: ["cards"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
  }

  const pct = progress.total ? (progress.processed / progress.total) * 100 : 0;

  async function countRawImportCards() {
    const rows = await fetchAllPages<{ id: string; full_text: string | null; channel_ids: string[] | null }>((from, to) =>
      supabase.from("cards").select("id,full_text,channel_ids").not("tg_message_id", "is", null).range(from, to),
    ).catch(() => null);
    if (!rows) {
      toast.error("Не удалось определить карточки неудачного импорта");
      return;
    }
    const ids = rows.filter((row) =>
      !row.full_text?.trim() || !(row.channel_ids ?? []).length,
    );
    setCleanupCount(ids.length);
    setCleanupOpen(true);
  }

  async function deleteRawImportCards() {
    const rows = await fetchAllPages<{ id: string; full_text: string | null; channel_ids: string[] | null }>((from, to) =>
      supabase.from("cards").select("id,full_text,channel_ids").not("tg_message_id", "is", null).range(from, to),
    ).catch(() => null);
    if (!rows) {
      toast.error("Не удалось удалить неудачные карточки импорта");
      return;
    }
    const ids = rows.filter((row) =>
      !row.full_text?.trim() || !(row.channel_ids ?? []).length,
    ).map((row) => row.id);

    let removed = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data, error } = await supabase.from("cards").delete().in("id", slice).select("id");
      if (error) {
        toast.error("Не удалось удалить неудачные карточки импорта");
        return;
      }
      removed += data?.length ?? 0;
    }
    setCleanupOpen(false);
    setCleanupCount(0);
    void qc.invalidateQueries({ queryKey: ["cards"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success(`Удалено карточек: ${removed}`);
  }

  return (
    <div className="space-y-8 animate-card-in">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">Импорт из Telegram</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          В Telegram Desktop: канал → ⋮ → «Экспорт истории чата», формат JSON, с фотографиями.
        </p>
      </div>

      <section>
        <SectionTitle>1. Файл экспорта</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => folderInput.current?.click()}
            className="index-card flex items-center gap-3 p-4 text-left transition-all hover:border-primary disabled:opacity-50"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-accent text-primary"><FolderOpen className="size-5" /></span>
            <span>
              <span className="block font-semibold">Вся папка экспорта</span>
              <span className="text-xs text-muted-foreground">result.json + картинки из photos/</span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="index-card flex items-center gap-3 p-4 text-left transition-all hover:border-primary disabled:opacity-50"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-secondary text-foreground"><FileJson className="size-5" /></span>
            <span>
              <span className="block font-semibold">Только result.json</span>
              <span className="text-xs text-muted-foreground">без картинок</span>
            </span>
          </button>
        </div>
        <input ref={folderInput} type="file" multiple className="hidden" onChange={(e) => { void onPickFolder(e.target.files); e.target.value = ""; }} />
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadJson(f, new Map(), `Файл «${f.name}»`);
            e.target.value = "";
          }}
        />
      </section>

      {parsed && (
        <>
          <section>
            <SectionTitle aside={<span className="text-xs text-muted-foreground">{sourceLabel}</span>}>2. Предпросмотр</SectionTitle>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <Stat label="постов найдено" value={parsed.posts.length} />
              <Stat label="с фото" value={withPhoto} />
              <Stat label="фото в папке" value={photosFound} muted={photos.size === 0} />
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              Чат: <span className="font-medium text-foreground">{parsed.chatName}</span> · id {parsed.chatId}
            </p>
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">№</th>
                    <th className="px-3 py-2 font-medium">Дата</th>
                    <th className="px-3 py-2 font-medium">Текст</th>
                    <th className="px-3 py-2 font-medium">Фото</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsed.posts.slice(0, 5).map((p) => (
                    <tr key={p.tgMessageId} className="align-top">
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{p.tgMessageId}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{p.date ? new Date(p.date).toLocaleDateString("ru-RU") : "—"}</td>
                      <td className="px-3 py-2.5"><span className="line-clamp-2 min-w-48">{p.text || <i className="text-muted-foreground">без текста</i>}</span></td>
                      <td className="px-3 py-2.5">
                        {p.photo ? (
                          <ImageIcon className={cn("size-4", photos.has(p.photo) ? "text-grade-easy" : "text-muted-foreground")} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <SectionTitle>3. Куда положить карточки</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <OptionCard
                active={destination === "ai"}
                onClick={() => !busy && setDestination("ai")}
                icon={<Sparkles className="size-5" />}
                title="Распределить через ИИ"
                description="По существующим категориям"
              />
              <OptionCard
                active={destination === "channel"}
                onClick={() => !busy && setDestination("channel")}
                icon={<Tag className="size-5" />}
                title="Всё в выбранный канал"
                description="Один канал для всех постов"
              />
            </div>
            {destination === "channel" && (
              <Select value={targetChannel} onValueChange={setTargetChannel} disabled={busy}>
                <SelectTrigger className="mt-2 h-11 rounded-xl bg-card"><SelectValue placeholder="Выберите канал" /></SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <label className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <Checkbox checked={skipExisting} onCheckedChange={(v) => setSkipExisting(v === true)} disabled={busy} />
              <span className="text-sm">
                Пропускать уже импортированные посты
                <span className="block text-xs text-muted-foreground">Иначе термин, крючок и текст перезапишутся, прогресс сохранится</span>
              </span>
            </label>
            <p className="mt-3 text-xs text-muted-foreground">
              ИИ для каждого поста придумывает термин и крючок.{" "}
              {settings.llmApiKey ? "Используется ваш ключ API из настроек." : (
                <>Работает встроенный ИИ; свой ключ можно указать в <Link to="/settings" className="text-primary underline-offset-2 hover:underline">настройках</Link>.</>
              )}
            </p>
          </section>

          <section className="index-card space-y-4 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-lg font-semibold">
                Обработано {progress.processed} из {progress.total}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
            </div>
            <Progress value={pct} className="h-2.5" />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>Обработано постов: {progress.processed} из {progress.total}</span>
              <span className="text-grade-easy">Создано карточек: {progress.created}</span>
              <span className="text-muted-foreground">Пропущено: {progress.skipped}</span>
              <span className={progress.failed ? "text-destructive" : "text-muted-foreground"}>Ошибок: {progress.failed}</span>
            </div>

            {notice && (
              <div className="flex items-start gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm text-accent-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {notice}
              </div>
            )}
            {status === "done" && (
              <div className="flex items-center gap-2 text-sm text-grade-easy">
                <CheckCircle2 className="size-4" /> Импорт завершён.{" "}
                <Link to="/library" className="underline underline-offset-2">Открыть базу</Link>
              </div>
            )}
            {status === "cancelled" && <p className="text-sm text-muted-foreground">Импорт остановлен.</p>}

            <div className="flex flex-wrap gap-2">
              {!busy ? (
                <Button size="xl" className="flex-1" onClick={() => void run()} disabled={!parsed.posts.length}>
                  <Play /> {status === "idle" ? "Начать импорт" : "Запустить заново"}
                </Button>
              ) : (
                <>
                  <Button
                    size="xl"
                    variant="secondary"
                    className="flex-1 border border-border"
                    onClick={() => {
                      pauseRef.current = !pauseRef.current;
                      setStatus(pauseRef.current ? "paused" : "running");
                      if (!pauseRef.current) setNotice(null);
                    }}
                  >
                    {status === "paused" ? <><Play /> Продолжить</> : <><Pause /> Пауза</>}
                  </Button>
                  <Button
                    size="xl"
                    variant="outline"
                    onClick={() => {
                      cancelRef.current = true;
                      pauseRef.current = false;
                    }}
                  >
                    <Square /> Отмена
                  </Button>
                </>
              )}
            </div>

            {errors.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Последние ошибки ({errors.length})</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            )}
          </section>
        </>
      )}

      {!parsed && (
        <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          <Label className="mb-1 block font-display text-base text-foreground">Как это работает</Label>
          Выберите экспорт → проверьте предпросмотр → ИИ сделает из каждого поста карточку «термин + крючок».
        </div>
      )}

      <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Очистка неудачного импорта</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Удалить карточки с заполненным tg_message_id и пустым full_text или channel_ids.
          </p>
        </div>
        <Button variant="outline" className="h-11 rounded-xl text-destructive" onClick={() => void countRawImportCards()}>
          <Trash2 /> Удалить карточки, импортированные без ИИ
        </Button>
      </section>

      <AlertDialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить неудачный импорт?</AlertDialogTitle>
            <AlertDialogDescription>
              Найдено карточек без ИИ-разметки: <b>{cleanupCount ?? 0}</b>. Это необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={!cleanupCount} onClick={() => void deleteRawImportCards()}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card px-3 py-3", muted && "opacity-60")}>
      <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

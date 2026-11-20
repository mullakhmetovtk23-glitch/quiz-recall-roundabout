import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Search, Sparkles } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { improveCardWithOwnKey } from "@/lib/labeler";
import { improveCard } from "@/lib/ai.functions";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { CARD_COLUMNS, type Card, type Channel } from "@/lib/db";
import { removeCardImage, uploadCardImage } from "@/lib/storage";

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: Channel[];
  /** null → create a new card */
  card: Card | null;
  defaultChannelId?: string | null;
  onSaved: (card: Card) => void;
}

export function CardFormDialog({ open, onOpenChange, channels, card, defaultChannelId, onSaved }: Props) {
  const [term, setTerm] = useState("");
  const [hook, setHook] = useState("");
  const [fullText, setFullText] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [aiComment, setAiComment] = useState("");
  const [aiPreview, setAiPreview] = useState<{term:string;hook:string;full_text:string;category_names:string[]} | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [relatedIds, setRelatedIds] = useState<string[]>([]);
  const [relatedSearch, setRelatedSearch] = useState("");
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const improveFn = useServerFn(improveCard);
  const { settings } = useSettings();

  useEffect(() => {
    if (!open) return;
    setTerm(card?.term ?? "");
    setHook(card?.hook ?? "");
    setFullText(card?.full_text ?? "");
    setChannelIds(card?.channel_ids?.length ? card.channel_ids : (defaultChannelId ? [defaultChannelId] : []));
    setAiComment("");
    setAiPreview(null);
    setFile(null);
    setPreview(card?.image_url ?? null);
    setRemoveImage(false);
    setRelatedIds(card?.related_card_ids ?? []);
    setRelatedSearch("");
    if (open) {
      void supabase.from("cards").select(CARD_COLUMNS).order("term").then(({ data }) => setAllCards((data ?? []) as Card[]));
    }
  }, [open, card, defaultChannelId]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function improve() {
    setAiLoading(true);
    try {
      const categoryNames = channels.map((c) => c.name);
      const result = settings.llmApiKey
        ? await improveCardWithOwnKey(term, hook, fullText, categoryNames, aiComment, settings)
        : await improveFn({ data: { term, hook, full_text: fullText, categories: categoryNames, comment: aiComment } });
      if (!result.ok) throw new Error(result.error);
      setAiPreview(result.card);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось улучшить карточку");
    } finally {
      setAiLoading(false);
    }
  }

  async function save() {
    if (!term.trim()) {
      toast.error("Укажите термин");
      return;
    }
    setSaving(true);
    try {
      let image_url = card?.image_url ?? null;
      if (file) {
        image_url = await uploadCardImage(file, file.name);
        if (card?.image_url) void removeCardImage(card.image_url);
      } else if (removeImage && card?.image_url) {
        void removeCardImage(card.image_url);
        image_url = null;
      }
      const values = {
        term: term.trim(),
        hook: hook.trim(),
        full_text: fullText.trim(),
        channel_ids: channelIds,
        image_url,
        related_card_ids: relatedIds,
      };
      const query = card
        ? supabase.from("cards").update(values).eq("id", card.id).select(CARD_COLUMNS).single()
        : supabase.from("cards").insert(values).select(CARD_COLUMNS).single();
      const { data, error } = await query;
      if (error) throw error;
      onSaved(data);
      toast.success(card ? "Карточка сохранена" : "Карточка добавлена");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Не удалось сохранить карточку");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-lg"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          e.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display">{card ? "Редактировать карточку" : "Новая карточка"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-accent/40 p-3">
            <Label htmlFor="cf-ai-comment">Пожелание для ИИ</Label>
            <Textarea id="cf-ai-comment" rows={2} value={aiComment} onChange={(e) => setAiComment(e.target.value)} placeholder="Например: добавь культурные связи или убери спойлер" className="mt-1.5" />
            <Button type="button" variant="secondary" className="mt-2" disabled={aiLoading} onClick={() => void improve()}>
              {aiLoading ? <Loader2 className="animate-spin" /> : <Sparkles />} Улучшить через ИИ
            </Button>
          </div>
          {aiPreview && (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
              <p className="font-semibold">Предпросмотр улучшения</p>
              <div><b>Термин:</b> {aiPreview.term}</div>
              <div><b>Крючок:</b> {aiPreview.hook}</div>
              <div className="whitespace-pre-wrap"><b>Факты:</b> {aiPreview.full_text}</div>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => {
                  setTerm(aiPreview.term); setHook(aiPreview.hook); setFullText(aiPreview.full_text);
                  setChannelIds(channels.filter((c) => aiPreview.category_names.includes(c.name)).map((c) => c.id).slice(0, 3));
                  setAiPreview(null);
                }}>Применить</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAiPreview(null)}>Отмена</Button>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cf-term">Термин (ответ)</Label>
            <Input id="cf-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Например: Кюри" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-hook">Крючок</Label>
            <Textarea id="cf-hook" rows={2} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="2–3 признака, не называя ответ" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-text">Полный текст заметки</Label>
            <Textarea id="cf-text" rows={6} value={fullText} onChange={(e) => setFullText(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Категории</Label>
            <div className="grid max-h-32 gap-1 overflow-y-auto rounded-xl border border-border p-2">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-secondary">
                  <Checkbox
                    checked={channelIds.includes(c.id)}
                    onCheckedChange={(v) => {
                      setChannelIds((ids) => v === true
                        ? [...new Set([...ids, c.id])].slice(0, 3)
                        : ids.filter((id) => id !== c.id));
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Картинка</Label>
            {preview && !removeImage ? (
              <div className="relative overflow-hidden rounded-xl border border-border">
                <img src={preview} alt="" className="max-h-56 w-full object-contain bg-muted" />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-2 top-2"
                  onClick={() => {
                    setFile(null);
                    setRemoveImage(true);
                  }}
                  aria-label="Убрать картинку"
                >
                  <Trash2 />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => fileInput.current?.click()}>
                <ImagePlus /> Загрузить картинку
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setRemoveImage(false);
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

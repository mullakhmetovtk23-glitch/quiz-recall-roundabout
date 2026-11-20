import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [channelId, setChannelId] = useState<string>(NONE);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTerm(card?.term ?? "");
    setHook(card?.hook ?? "");
    setFullText(card?.full_text ?? "");
    setChannelId(card ? (card.channel_id ?? NONE) : (defaultChannelId ?? NONE));
    setFile(null);
    setPreview(card?.image_url ?? null);
    setRemoveImage(false);
  }, [open, card, defaultChannelId]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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
        channel_id: channelId === NONE ? null : channelId,
        image_url,
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
            <Label>Канал</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Без канала</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

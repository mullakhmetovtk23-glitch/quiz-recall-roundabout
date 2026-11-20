import { supabase } from "@/integrations/supabase/client";

const BUCKET = "card-images";
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

/** Uploads an image and returns a long-lived link to store in cards.image_url. */
export async function uploadCardImage(file: Blob, fileName: string, folder = "manual"): Promise<string> {
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}` });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, TEN_YEARS);
  if (signError || !data) throw signError ?? new Error("Не удалось получить ссылку на картинку");
  return data.signedUrl;
}

export function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/object\/(?:sign|public)\/card-images\/([^?]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export async function removeCardImage(url: string | null): Promise<void> {
  const path = storagePathFromUrl(url);
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Channel = Tables<"channels">;
export type Card = Omit<Tables<"cards">, "search_vector" | "channel_id" | "tg_rendered_text">;

export const CARD_COLUMNS =
  "id,channel_ids,related_card_ids,term,hook,full_text,image_url,source_chat_id,tg_message_id,fwd_box,fwd_due_at,fwd_reviewed_at,rev_box,rev_due_at,rev_reviewed_at,created_at,updated_at" as const;

export const channelsQuery = queryOptions({
  queryKey: ["channels"],
  queryFn: async (): Promise<Channel[]> => {
    const { data, error } = await supabase
      .from("channels")
      .select("*")
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return data;
  },
});

export interface ChannelStat {
  channel_id: string | null;
  total: number;
  due_forward: number;
  due_reverse: number;
}

export const statsQuery = queryOptions({
  queryKey: ["stats"],
  queryFn: async (): Promise<ChannelStat[]> => {
    const { data, error } = await supabase.rpc("channel_stats");
    if (error) throw error;
    return (data ?? []).map((r) => ({
      channel_id: r.channel_id,
      total: Number(r.total),
      due_forward: Number(r.due_forward),
      due_reverse: Number(r.due_reverse),
    }));
  },
});

/** Prefix full-text query for the russian tsvector: "нау мед" → "нау:* & мед:*" */
export function buildTsQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((w) => `${w}:*`)
    .join(" & ");
}

const PAGE = 1000;

/** Reads every matching row past the 1000-row API cap. */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

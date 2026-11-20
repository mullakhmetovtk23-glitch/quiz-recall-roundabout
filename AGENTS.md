<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- Data access goes straight from the browser through the generated Supabase client with open RLS (no auth) — the app is a single-user personal tool by owner's choice.
- AI post labeling runs in `src/lib/ai.functions.ts` (server function on the Lovable AI Gateway); an optional user-supplied OpenAI-compatible key in localStorage is called from the browser via `src/lib/labeler.ts`. Both share prompts from `src/lib/label-prompt.ts`.
- Leitner scheduling lives only in `src/lib/leitner.ts` (covered by tests); forward and reverse progress are separate column sets (`fwd_*`, `rev_*`) on `cards`.
- The `card-images` bucket is private (workspace blocks public buckets); `image_url` stores a long-lived signed URL produced by `src/lib/storage.ts`.
- Telegram export parsing is pure and tested in `src/lib/telegram.ts`; keep it free of browser/DB calls.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/telegram-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.clone().json().catch(() => null) as any;
        if (body?.action === "checkTelegramWebhook") {
          const { checkTelegramWebhook } = await import("@/lib/telegram-webhook.server");
          return Response.json(await checkTelegramWebhook(String(body.url ?? "")));
        }
        const { handleTelegramWebhook } = await import("@/lib/telegram-webhook.server");
        return handleTelegramWebhook(request);
      },
      OPTIONS: () => new Response(null, { status: 204 }),
    },
  },
});
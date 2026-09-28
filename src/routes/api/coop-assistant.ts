import { createFileRoute } from "@tanstack/react-router";
import { handleCoopAssistant } from "@/lib/coop-assistant.server";

export const Route = createFileRoute("/api/coop-assistant")({
  server: { handlers: { POST: ({ request }) => handleCoopAssistant(request) } },
});

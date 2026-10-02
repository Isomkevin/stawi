import { createFileRoute } from "@tanstack/react-router";
import { llmsTxt, publicOrigin } from "@/lib/site";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(llmsTxt(publicOrigin()), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=3600",
            "x-robots-tag": "noindex",
          },
        }),
    },
  },
});

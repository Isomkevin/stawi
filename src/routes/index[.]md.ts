import { createFileRoute } from "@tanstack/react-router";
import { landingMarkdown, publicOrigin } from "@/lib/site";

export const Route = createFileRoute("/index.md")({
  server: {
    handlers: {
      GET: () =>
        new Response(landingMarkdown(publicOrigin()), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "public, max-age=3600",
            "x-robots-tag": "noindex",
            link: '</llms.txt>; rel="describedby"',
          },
        }),
    },
  },
});

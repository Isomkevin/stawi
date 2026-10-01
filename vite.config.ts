// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        manifest: false,
        devOptions: { enabled: false },
        workbox: {
          // TanStack Start has no static index.html. The default fallback
          // throws non-precached-url during service-worker startup.
          navigateFallback: null,
          // The build folders are client/ and server/. The site serves client
          // files from /. Without this rewrite, precache fetches /client/assets/*
          // (404) and Workbox aborts install — the "zig-*.js" console error.
          modifyURLPrefix: { "client/": "/" },
          // Shell only. Hashed JS is cached when a page requests it. Precaching
          // every chunk includes Shiki and Mermaid grammars, and one 404 fails
          // the whole install.
          globPatterns: ["**/*.{css,ico,png,svg,webp,woff,woff2,webmanifest}"],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" && !/^\/~oauth(?:\/|$)/.test(url.pathname),
              handler: "NetworkFirst",
              options: {
                cacheName: "stawi-pages",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              urlPattern: ({ request, url }) =>
                url.origin === self.location.origin &&
                ["script", "style", "font", "image"].includes(request.destination) &&
                /\.[a-f0-9]{8,}\./i.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "stawi-assets",
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

/** Installable web app manifest. `public/manifest.json` must stay a copy of this object. */
export const webManifest = {
  id: "/",
  name: "Stawi",
  short_name: "Stawi",
  description: "Cross-border export payments that split one buyer payment among every farmer.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#233c31",
  theme_color: "#233c31",
  categories: ["finance", "business", "productivity"],
  icons: [
    {
      src: "/stawi-icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/stawi-icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/stawi-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  shortcuts: [
    {
      name: "Stawi home",
      short_name: "Stawi",
      description: "Open your Stawi home screen",
      url: "/app/home",
      icons: [{ src: "/stawi-icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Sign in",
      short_name: "Sign in",
      url: "/login",
      icons: [{ src: "/stawi-icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Buyer portal",
      short_name: "Pay shipment",
      url: "/buyer",
      icons: [{ src: "/stawi-icon-192.png", sizes: "192x192", type: "image/png" }],
    },
  ],
};

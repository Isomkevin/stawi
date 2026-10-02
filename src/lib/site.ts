import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

export const SITE_NAME = "Stawi";

export const SITE_TITLE = "Stawi — One payment in. Every farmer paid, same day.";

export const SITE_DESCRIPTION =
  "A co-op treasurer used to spend days paying farmers in cash. Stawi turns one buyer payment into a same-day split, with a flat 0.8% fee on the invoice.";

export const OG_DESCRIPTION =
  "One buyer payment. A treasurer's approval. Every farmer paid the same day, to M-Pesa or a bank. 0.8% flat, written on the invoice.";

export const PRODUCTS_SENTENCE =
  "The same payment works for one exporter, or for a co-op that splits it across every farmer on the shipment.";

export const OG_IMAGE_ALT =
  "Stawi: one payment in, every farmer paid the same day, to M-Pesa or a bank.";

/** Production origin named in the Payaza receipt redirect. Set VITE_SITE_URL before launch. */
export const DOCUMENTED_ORIGIN = "https://stawi.africa";

export const PUBLIC_FAQS = [
  {
    question: "What does Stawi charge?",
    answer:
      "Stawi takes 0.8% of the shilling amount, before anyone is paid. The buyer sees it. Every farmer's line shows it. There is no subscription, and nothing extra is taken from the farmer.",
  },
  {
    question: "Who releases the money?",
    answer:
      "The treasurer sees every share, and the 0.8% fee, before a shilling moves. Nothing is released until the treasurer says so. A solo exporter is credited in full, with no split to approve.",
  },
  {
    question: "Where can a farmer withdraw?",
    answer:
      "Each share lands in that farmer's Stawi balance. They withdraw to M-Pesa or a bank. Money only goes to the M-Pesa number or bank account they registered.",
  },
  {
    question: "Does a farmer need a smartphone?",
    answer:
      "No. A smartphone gets the full account, in English or Swahili. A basic phone dials in and sees the same balance. No smartphone and no data are required.",
  },
] as const;

export const noindexMeta = { name: "robots", content: "noindex, nofollow" } as const;

const readRequestUrl = createIsomorphicFn()
  .server(() => getRequestUrl().href)
  .client(() => window.location.href);

export function configuredSiteUrl(): string | undefined {
  const raw = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

export function requestUrl(): URL {
  return new URL(readRequestUrl());
}

/** Canonical origin. VITE_SITE_URL wins; otherwise the host that served the request. */
export function publicOrigin(): string {
  return configuredSiteUrl() ?? requestUrl().origin;
}

export function isNonIndexableHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host.includes("preview")) return true;
  return false;
}

/** Preview and localhost must not compete with the public site in search. */
export function shouldNoindex(): boolean {
  const request = requestUrl();
  if (isNonIndexableHost(request.hostname)) return true;
  const configured = configuredSiteUrl();
  if (configured && request.origin !== configured) return true;
  return false;
}

type HeadMeta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
  | { "script:ld+json": Record<string, unknown> };

type HeadLink = { rel: string; href: string; type?: string };

export function ogImageUrl(origin: string): string {
  return `${origin}/og.png`;
}

export function sharedSocialMeta(origin: string): HeadMeta[] {
  const image = ogImageUrl(origin);
  return [
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "en_KE" },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: OG_IMAGE_ALT },
    { name: "twitter:image", content: image },
  ];
}

export function structuredData(origin: string): Record<string, unknown> {
  const orgId = `${origin}/#organization`;
  const offerDescription =
    "0.8% of the shilling amount, shown on the invoice before anyone is paid. No subscription, and nothing extra is taken from the farmer.";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: `${origin}/stawi-icon-512.png`,
        description: PRODUCTS_SENTENCE,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: SITE_NAME,
        url: `${origin}/`,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": orgId },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#app`,
        name: SITE_NAME,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web, USSD",
        url: `${origin}/`,
        description: OG_DESCRIPTION,
        provider: { "@id": orgId },
        offers: {
          "@type": "Offer",
          description: offerDescription,
          priceCurrency: "KES",
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}/#faq`,
        url: `${origin}/#faq`,
        mainEntity: PUBLIC_FAQS.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
    ],
  };
}

export function homeHead(): { meta: HeadMeta[]; links: HeadLink[] } {
  const origin = publicOrigin();
  const image = ogImageUrl(origin);
  const meta: HeadMeta[] = [
    { title: SITE_TITLE },
    { name: "description", content: SITE_DESCRIPTION },
    { property: "og:title", content: SITE_TITLE },
    { property: "og:description", content: OG_DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${origin}/` },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: OG_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: SITE_TITLE },
    { name: "twitter:description", content: OG_DESCRIPTION },
    { name: "twitter:image", content: image },
    { "script:ld+json": structuredData(origin) },
  ];
  if (shouldNoindex()) meta.push(noindexMeta);
  return {
    meta,
    links: [
      { rel: "canonical", href: `${origin}/` },
      { rel: "alternate", href: `${origin}/index.md`, type: "text/markdown" },
      { rel: "describedby", href: `${origin}/llms.txt` },
    ],
  };
}

export function landingMarkdown(origin: string): string {
  const faq = PUBLIC_FAQS.map((item) => `### ${item.question}\n\n${item.answer}`).join("\n\n");
  return `# Stawi

> ${SITE_TITLE.replace("Stawi — ", "")}

${SITE_DESCRIPTION}

${PRODUCTS_SENTENCE}

The buyer pays in dollars, euros, or pounds. Stawi shows the shilling amount and a flat 0.8% fee before anyone is paid. Each person withdraws to M-Pesa or a bank the same day.

## Who it is for

- A solo exporter is paid in full when the buyer pays. There is no split to approve.
- An export co-op receives one payment. The treasurer sees every farmer's share and the fee, then releases it. Each farmer withdraws their own share.

## How a payment moves

1. The buyer pays once. The exporter or co-op sends one invoice. The buyer sees the fee before they confirm.
2. A co-op treasurer approves. Shillings, the 0.8% fee, and every farmer's share sit on one screen. Nothing is released until the treasurer says so.
3. The payee is credited. A solo exporter receives the full net amount. Each co-op farmer's share lands in that farmer's Stawi balance. They withdraw to M-Pesa or a bank, on a smartphone or a basic phone.

## Farmers

A farmer joins with the phone they already have.

1. The treasurer sends a link. The co-op and the farmer's share are already filled in.
2. The farmer enters their name, national ID, and the phone they will use to sign in.
3. They add an M-Pesa number or a bank account. That is the only place a payout can land.
4. They choose a four-digit PIN. The treasurer cannot withdraw on a farmer's behalf.

A basic phone can check the balance and withdraw. It cannot type in a new number.

## Any phone

A smartphone gets the full account, in English or Swahili. A basic phone dials in and sees the same balance. The payout still goes only to the M-Pesa number or bank account they added when they joined. No smartphone and no data are required.

## Pricing

${PUBLIC_FAQS[0].answer}

On a buyer payment of EUR 8,600, the fee is about KES 9,600. The rest is the farmers'.

## Questions

${faq}

The public page is ${origin}/.
`;
}

export function llmsTxt(origin: string): string {
  return `# Stawi

> One buyer payment, in the buyer's currency, becomes Kenya shillings the same day. A solo exporter is paid in full. A co-op treasurer approves a split, and every farmer can withdraw to M-Pesa or a bank.

Stawi is for African export businesses. The fee is 0.8% of the shilling amount, written on the invoice before anyone is paid. There is no subscription, and nothing extra is taken from the farmer.

${PRODUCTS_SENTENCE} A farmer can use a smartphone, in English or Swahili, or dial in on a basic phone. Both show the same balance. Money only goes to the M-Pesa number or bank account they registered.

Signed-in dashboards, invoices, and buyer payment links are private. They are not part of this file.

## Pages

- [Stawi](${origin}/index.md): What Stawi does, who it is for, the 0.8% fee, and how a payment reaches a farmer.
`;
}

export function sitemapXml(origin: string): string {
  const loc = escapeXml(`${origin}/`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${loc}</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

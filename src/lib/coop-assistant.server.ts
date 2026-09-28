import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

const RUN_ID = "X-Lovable-AIG-Run-ID";

const Body = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
  snapshot: z.unknown(),
});

const SYSTEM = `You are Stawi's co-op finance assistant for a coffee co-op treasurer in Kenya.
Answer ONLY from the JSON data snapshot provided. All *_kes_cents fields are integer KES cents: divide by 100 and format as "KES 12,345.00".
Invoice "amount" is in the buyer's currency. Explain how you got each number (which invoices/payouts/members you summed).
If the data does not contain the answer, say so plainly — never guess or invent figures. Keep answers short, use bullet points for lists.`;

export async function handleCoopAssistant(request: Request): Promise<Response> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return Response.json({ error: "AI is not configured" }, { status: 500 });

  const raw = await request.text();
  if (raw.length > 400_000) return Response.json({ error: "Too much data to analyse" }, { status: 400 });
  const parsed = Body.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) return Response.json({ error: "Invalid question" }, { status: 400 });
  const { question, history, snapshot } = parsed.data;

  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set(RUN_ID, runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get(RUN_ID) ?? undefined;
      return res;
    },
  });

  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system: `${SYSTEM}\n\nDATA SNAPSHOT:\n${JSON.stringify(snapshot)}`,
    messages: [...history, { role: "user", content: question }],
    abortSignal: request.signal,
    maxRetries: 0,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
    onError: ({ error }) => console.error("[coop-assistant]", error),
  });

  return result.toTextStreamResponse({ headers: { "Cache-Control": "no-cache, no-transform" } });
}

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PAY_CURRENCIES, formatKesRate, illustrativeFxQuote } from "@/lib/payCurrencies";

export function FxSourceCard() {
  const fx = useQuery({
    queryKey: ["fx"],
    queryFn: () => api.getFxQuote(),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const quote = fx.data ?? (fx.isError ? illustrativeFxQuote() : null);
  const live = quote?.source === "frankfurter";

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-medium">Exchange rates</h2>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {fx.isLoading ? "Loading" : live ? "Frankfurter" : "Illustrative"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {fx.isLoading
          ? "Loading the rates checkout and settlement use."
          : live
            ? `Daily central-bank rates${quote?.as_of ? `, as of ${quote.as_of}` : ""}. Checkout and settlement convert to Kenyan shillings at these rates.`
            : "Built-in KES rates. Stawi uses these when the Frankfurter feed is unavailable."}
      </p>
      {fx.isError && (
        <p className="mt-2 text-sm text-terracotta">The live feed could not be loaded.</p>
      )}
      {quote && (
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {PAY_CURRENCIES.map((code) => (
            <div key={code} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-muted-foreground">{code}</dt>
              <dd className="tabular">{formatKesRate(code, quote.rates)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

import { registerSW } from "virtual:pwa-register";

function isLovablePreview(hostname: string) {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

async function unregisterStawiWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => {
        const scriptUrl = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL;
        return scriptUrl?.endsWith("/sw.js") ?? false;
      })
      .map((registration) => registration.unregister()),
  );
}

export async function initializePwa() {
  const isTopLevel = window.self === window.top;
  const disabled = new URLSearchParams(window.location.search).get("sw") === "off";
  const mayRegister = import.meta.env.PROD && isTopLevel && !isLovablePreview(window.location.hostname) && !disabled;

  if (!mayRegister) {
    await unregisterStawiWorkers();
    return;
  }

  registerSW({ immediate: true });
}
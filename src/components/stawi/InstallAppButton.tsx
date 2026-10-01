import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  canPromptInstall,
  ensureInstallPromptListener,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa-install";
import { cn } from "@/lib/utils";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallAppButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState<string | null>(null);

  useEffect(() => {
    ensureInstallPromptListener();
    setInstalled(isStandalone());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setCanPrompt(canPromptInstall());
    return subscribeInstallPrompt(() => {
      setCanPrompt(canPromptInstall());
      setInstalled(isStandalone());
    });
  }, []);

  if (installed) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{t("pwa.done")}</p>;
  }

  return (
    <div className={className}>
      <Button
        type="button"
        className="h-11 w-full"
        onClick={() => {
          if (!canPrompt) {
            setHelp(ios ? t("pwa.ios") : t("pwa.manual"));
            return;
          }
          void promptInstall().then((accepted) => {
            if (accepted) setInstalled(true);
          });
        }}
      >
        <Smartphone /> {t("pwa.install")}
      </Button>
      {help ? <p className="mt-2 text-sm text-muted-foreground">{help}</p> : null}
    </div>
  );
}

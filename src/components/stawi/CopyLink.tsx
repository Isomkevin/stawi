import { useState } from "react";
import { Check, Copy, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function CopyLink({ url, subject = "Stawi payment link" }: { url: string; subject?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Payment link copied");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{url}</span>
        <Button size="sm" onClick={copy} className="min-h-[40px]">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
            <MessageCircle className="size-4" strokeWidth={1.75} /> WhatsApp
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(url)}`}>
            <Mail className="size-4" strokeWidth={1.75} /> Email
          </a>
        </Button>
      </div>
    </div>
  );
}

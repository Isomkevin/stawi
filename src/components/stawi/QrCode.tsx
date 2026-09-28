import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Skeleton } from "@/components/ui/skeleton";

export function QrCode({ value, size = 144 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#16241B", light: "#F7F8F5" },
    })
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!src) return <Skeleton style={{ width: size, height: size }} className="rounded-xl" />;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QR code for this payment link"
      className="rounded-xl border border-border bg-cream p-1"
    />
  );
}

from pathlib import Path

p = Path(r"C:\Users\Administrator\Desktop\stawi\src\routes\coop.shipments.tsx")
text = p.read_text(encoding="utf-8")
first = text.find("function confirmCopy")
start = text.find("function confirmCopy", first + 1)
end = text.find("function Fact(")
if start < 0 or end < 0:
    raise SystemExit(f"markers missing {start} {end}")

replacement = r'''function PayFarmerShares({ inv, count }: { inv: Invoice; count: number }) {
  const qc = useQueryClient();
  const treasurerId = useAccountId();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (nextPin: string) => api.approveSplit(inv.id, treasurerId, nextPin),
    onSuccess: async () => {
      setOpen(false);
      setPin("");
      toast.success(inv.is_demo ? "Sample split approved" : "Payaza is sending each share to M-Pesa");
      await qc.invalidateQueries();
    },
    onError: (err) => {
      setPin("");
      setPinErr(err instanceof ApiError && err.code === "wrong" ? "Wrong PIN. Try again." : "Couldn't send the payout. Try again.");
    },
  });
  return (
    <div className="mt-3">
      <Button size="sm" onClick={() => { setPin(""); setPinErr(null); setOpen(true); }}>
        {inv.is_demo ? "Approve sample split" : "Send shares to M-Pesa"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        {inv.is_demo
          ? "Sample money stays in Stawi. A live invoice sends each confirmed share to M-Pesa through Payaza."
          : "Approving pays every farmer on this shipment. Payaza sends each share to their M-Pesa number."}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm with your PIN</DialogTitle>
            <DialogDescription>
              {inv.is_demo
                ? "Approves the sample split. Payaza is not called for sample money."
                : `Sends ${inv.kes_total_cents ? formatKesCents(inv.kes_total_cents) : "the confirmed shares"} to ${count} M-Pesa ${count === 1 ? "number" : "numbers"} through Payaza.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <PinPad
              value={pin}
              error={pinErr}
              onChange={(next) => {
                setPinErr(null);
                setPin(next);
                if (next.length === 4) approve.mutate(next);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

'''
p.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
print("spliced", start, end)

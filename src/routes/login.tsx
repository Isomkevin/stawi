import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Leaf, Phone, ShieldCheck } from "lucide-react";
import { homeForRole, useSession } from "@/lib/session";
import type { Role } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Stawi" },
      {
        name: "description",
        content: "Sign in to Stawi with your phone number and a one-time code.",
      },
      { property: "og:title", content: "Sign in — Stawi" },
      { property: "og:description", content: "Phone + one-time-code sign in for Stawi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

const DEMO_CODE = "123456";

const roleCards: Array<{ role: Exclude<Role, "buyer">; title: string; body: string }> = [
  {
    role: "farmer",
    title: "I'm a farmer",
    body: "See your balance, incoming payments and withdraw to M-Pesa.",
  },
  {
    role: "treasurer",
    title: "I run a co-op",
    body: "Invoice buyers, review splits and release payouts to members.",
  },
  {
    role: "exporter",
    title: "I export directly",
    body: "Invoice buyers and get paid straight to your own account.",
  },
];

function LoginPage() {
  return (
    <div className="motif grain relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <Link back />
    </div>
  );
}

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fulfillmentLabel, paymentLabel } from "@/lib/format";

export function Button({
  href,
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: string;
  variant?: "primary" | "pine" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-copper text-white hover:bg-copperDark",
    pine: "bg-pine text-white hover:bg-[#16392b]",
    ghost: "border border-line bg-card text-ink hover:border-ink/30",
    danger: "bg-red-700 text-white hover:bg-red-800",
  }[variant];
  const classNames = `inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`;
  if (href) return <Link href={href} className={classNames}>{children}</Link>;
  return (
    <button className={classNames} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>{children}</section>;
}

export function Badge({ children, tone = "paper" }: { children: ReactNode; tone?: "paper" | "pine" | "gold" | "alert" }) {
  const styles = {
    paper: "bg-paper text-ink",
    pine: "bg-pineSoft text-pine",
    gold: "bg-gold text-ink",
    alert: "bg-red-100 text-red-800",
  }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles}`}>{children}</span>;
}

export function StatusBadge({ value, kind }: { value: string; kind: "pay" | "ship" }) {
  const label = kind === "pay" ? paymentLabel(value) : fulfillmentLabel(value);
  const alert = ["FAILED", "EXPIRED", "REFUNDED"].includes(value);
  const good = ["PAID", "SHIPPED", "DELIVERED", "DISPATCHED_TO_SUPPLIER"].includes(value);
  return <Badge tone={alert ? "alert" : good ? "pine" : "gold"}>{label}</Badge>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-ink/80">{label}</span>
      {children}
    </label>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl text-ink">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </Card>
  );
}

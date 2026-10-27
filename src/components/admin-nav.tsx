"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ links }: { links: Array<[string, string]> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {links.map(([href, label]) => {
        const active = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-xl px-3 py-2 text-sm ${active ? "bg-ink text-white" : "border border-line bg-card"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

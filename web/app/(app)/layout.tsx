import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/audits", label: "Audits" },
  { href: "/new-audit", label: "New audit" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1a0b2e_0%,_#0a0612_60%)] text-white">
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <aside className="border-r border-zinc-800/60 px-4 py-6 flex flex-col gap-1">
          <Link href="/" className="px-3 py-2 mb-4">
            <span className="font-semibold tracking-tight text-lg">Otis</span>
            <span className="text-xs text-zinc-500 block">AI call auditor</span>
          </Link>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-md text-sm text-zinc-300 hover:bg-zinc-800/50 hover:text-white transition"
            >
              {item.label}
            </Link>
          ))}
        </aside>
        <main className="overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import AuroraBackground from "@/components/aurora-background";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/audits", label: "Audits" },
  { href: "/new-audit", label: "New audit" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen text-white relative">
      <AuroraBackground />
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <aside className="border-r border-white/5 px-4 py-6 flex flex-col gap-1 backdrop-blur-xl bg-black/20">
          <Link href="/" className="px-3 py-2 mb-4 group">
            <span className="font-semibold tracking-tight text-lg bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent group-hover:from-cyan-200 group-hover:to-fuchsia-300 transition-all duration-300">
              Otis
            </span>
            <span className="text-xs text-zinc-500 block">AI call auditor</span>
          </Link>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-md text-sm text-zinc-300 hover:bg-white/5 hover:text-white transition relative group"
            >
              <span className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-violet-400 to-fuchsia-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              {item.label}
            </Link>
          ))}
        </aside>
        <main className="overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

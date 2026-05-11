"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setSending(false);
    if (error) setError(error.message);
    else setSentTo(email);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1a0b2e_0%,_#0a0612_60%)] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold">Sign in to Otis</h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Continue with Google or a magic link.
          </p>
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 py-2.5 text-sm font-medium transition"
        >
          Continue with Google
        </button>

        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-zinc-500">
          <div className="h-px flex-1 bg-zinc-800" />
          or
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {sentTo ? (
          <div className="text-sm text-zinc-300 text-center">
            Sent a sign-in link to <strong>{sentTo}</strong>. Check your inbox.
          </div>
        ) : (
          <form onSubmit={signInWithEmail} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            />
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <p className="text-xs text-zinc-500 text-center">
          By signing in you agree that Otis will store your audits.
        </p>

        <button
          type="button"
          onClick={() => router.push("/")}
          className="block mx-auto text-xs text-zinc-500 hover:text-zinc-300 transition"
        >
          &larr; Back to landing
        </button>
      </div>
    </main>
  );
}

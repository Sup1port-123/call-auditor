"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  }
  return (
    <button
      onClick={logout}
      className="text-xs text-zinc-400 hover:text-white transition"
    >
      Sign out
    </button>
  );
}

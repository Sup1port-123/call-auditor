"use client";

import Link from "next/link";
import { motion } from "motion/react";
import LottiePlayer from "@/components/lottie-player";
import AuroraBackground from "@/components/aurora-background";

export default function LandingPage() {
  return (
    <main className="min-h-screen text-white relative overflow-hidden">
      <AuroraBackground />
      <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="w-48 h-48 mb-8"
        >
          <LottiePlayer src="/lottie/hey.lottie" className="w-full h-full" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="uppercase tracking-[0.25em] text-xs text-cyan-300 mb-6"
        >
          Hi, I&apos;m Otis &middot; I audit AI calls so you don&apos;t have to
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="text-5xl md:text-7xl font-bold text-center max-w-3xl leading-[1.05]"
        >
          Are your AI calls{" "}
          <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
            doing it right
          </span>
          ?
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-zinc-400 mt-6 max-w-xl text-center"
        >
          Drop a recording. Otis transcribes it with speaker diarization,
          scores it against your rubric, and tells you exactly where your AI
          nailed it &mdash; or fumbled.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-10"
        >
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-3 text-base font-medium hover:opacity-90 hover:scale-[1.02] transition shadow-[0_0_60px_-10px_rgba(232,121,249,0.55)]"
          >
            Let&apos;s find out &rarr;
          </Link>
        </motion.div>
      </div>
    </main>
  );
}

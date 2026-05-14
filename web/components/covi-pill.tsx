"use client";

import { motion } from "motion/react";

type Tone = "sky" | "violet" | "pink";

const TONE_BG: Record<Tone, string> = {
  sky: "linear-gradient(135deg, rgba(186,229,255,0.85), rgba(118,189,247,0.85))",
  violet:
    "linear-gradient(135deg, rgba(216,202,255,0.85), rgba(168,156,239,0.85))",
  pink: "linear-gradient(135deg, rgba(248,200,231,0.85), rgba(232,156,201,0.85))",
};

// Glassmorphic floating pill — matches the COVI hero treatment. Subtle
// drift loop, animated in with a soft delay so it feels intentional.
export default function CoviPill({
  label,
  tone = "sky",
  className,
  delay = 0,
  driftFromX = -8,
  driftFromY = -4,
}: {
  label: string;
  tone?: Tone;
  className?: string;
  delay?: number;
  driftFromX?: number;
  driftFromY?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: driftFromY, x: driftFromX, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{
          duration: 5 + Math.random() * 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: TONE_BG[tone],
          boxShadow:
            "0 12px 40px -10px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
        className="inline-block rounded-full px-7 py-3 text-white font-medium tracking-tight backdrop-blur-md border border-white/40"
      >
        {label}
      </motion.div>
    </motion.div>
  );
}

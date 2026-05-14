"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView } from "motion/react";

export default function AnimatedCounter({
  value,
  decimals = 0,
  duration = 1.6,
  className,
  suffix,
}: {
  value: number | null;
  decimals?: number;
  duration?: number;
  className?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(value == null ? "—" : "0");

  useEffect(() => {
    if (!inView || value == null) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(v) {
        setDisplay(v.toFixed(decimals));
      },
    });
    return () => controls.stop();
  }, [inView, value, decimals, duration]);

  return (
    <span ref={ref} className={className}>
      {display}
      {suffix}
    </span>
  );
}

"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export default function LottiePlayer({
  src,
  loop = true,
  autoplay = true,
  className,
}: {
  src: string;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <DotLottieReact src={src} loop={loop} autoplay={autoplay} />
    </div>
  );
}

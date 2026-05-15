"use client";

import { useEffect, useRef } from "react";

// Lazily register the model-viewer custom element on the client only.
// SSR can't touch HTMLElement so we import inside useEffect.
// Once registered, <model-viewer> becomes a valid HTML tag.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          autoplay?: boolean | "";
          "camera-controls"?: boolean | "";
          "disable-zoom"?: boolean | "";
          "interaction-prompt"?: "auto" | "when-focused" | "none";
          "camera-orbit"?: string;
          "field-of-view"?: string;
          "shadow-intensity"?: string;
          "environment-image"?: string;
          exposure?: string;
          "animation-name"?: string;
        },
        HTMLElement
      >;
    }
  }
}

export default function OtisBiped({
  src = "/otis-walking.glb",
  className,
}: {
  src?: string;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Register the custom element on mount. Import is dynamic so it's
    // tree-shaken out of the server bundle.
    import("@google/model-viewer");
  }, []);

  useEffect(() => {
    const el = ref.current as
      | (HTMLElement & {
          cameraOrbit?: string;
          fieldOfView?: string;
        })
      | null;
    if (!el) return;
    const onMouseMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const dx = ((e.clientX - cx) / cx) * 6; // ±6° yaw
      // gentle parallax: only horizontal yaw — vertical pitch fixed
      el.setAttribute("camera-orbit", `${dx}deg 80deg auto`);
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  return (
    <model-viewer
      ref={ref as React.RefObject<HTMLElement>}
      src={src}
      alt="Otis, your AI call auditor"
      autoplay
      disable-zoom
      interaction-prompt="none"
      camera-orbit="0deg 80deg auto"
      field-of-view="22deg"
      shadow-intensity="0.9"
      exposure="1.1"
      style={{
        width: "100%",
        height: "100%",
        background: "transparent",
        ["--poster-color" as string]: "transparent",
      }}
      className={className}
    />
  );
}

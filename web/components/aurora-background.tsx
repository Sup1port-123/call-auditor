// Pure-CSS drifting gradient background. Two oversized blobs slowly orbit,
// giving the dark surface a subtle "alive" feel without burning battery
// (no per-frame JS, just keyframe transforms).

export default function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora-blob aurora-blob-violet" />
      <div className="aurora-blob aurora-blob-cyan" />
      <div className="aurora-blob aurora-blob-fuchsia" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(26,11,46,0.4)_0%,#0a0612_70%)]" />
    </div>
  );
}

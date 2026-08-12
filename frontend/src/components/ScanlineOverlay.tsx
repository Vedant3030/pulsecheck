/** Fixed CRT scanline + vignette overlay — static, no animation. Monitor wall only. */
export function ScanlineOverlay() {
  return (
    <div
      className="scanline-overlay pointer-events-none fixed inset-0 z-50"
      aria-hidden="true"
    />
  );
}

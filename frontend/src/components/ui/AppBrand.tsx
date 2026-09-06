import Link from "next/link";

interface AppBrandProps {
  href?: string;
  compact?: boolean;
  tagline?: string;
}

export function AppBrand({ href = "/", compact = false, tagline = "Reliable service monitoring" }: AppBrandProps) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden>
        <span className="brand-mark-inner">⌁</span>
        <span className="brand-pulse-ring" aria-hidden />
      </span>
      {!compact && (
        <span>
          <span className="brand-name">PulseCheck</span>
          <span className="brand-tagline">{tagline}</span>
        </span>
      )}
    </>
  );
  return <Link href={href} className="brand">{content}</Link>;
}

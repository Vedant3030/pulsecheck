import Link from "next/link";

interface AppBrandProps {
  href?: string;
  compact?: boolean;
}

export function AppBrand({ href = "/", compact = false }: AppBrandProps) {
  const content = <><span className="brand-mark" aria-hidden>⌁</span>{!compact && <span><span className="brand-name">PulseCheck</span><span className="brand-tagline">Reliable service monitoring</span></span>}</>;
  return <Link href={href} className="brand">{content}</Link>;
}

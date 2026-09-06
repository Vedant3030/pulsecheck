import { AppBrand } from "@/components/ui/AppBrand";

interface AuthLayoutProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return <main className="auth-page bulb-pulse-wave animate min-h-screen flex items-center justify-center"><section className="auth-card phosphor-grid-pulse animate"><AppBrand /><div className="auth-copy"><h1>{title}</h1><p>{description}</p></div>{children}</section></main>;
}

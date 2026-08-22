import { AppBrand } from "@/components/ui/AppBrand";

interface AuthLayoutProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return <main className="auth-page"><section className="auth-card"><AppBrand /><div className="auth-copy"><h1>{title}</h1><p>{description}</p></div>{children}</section></main>;
}

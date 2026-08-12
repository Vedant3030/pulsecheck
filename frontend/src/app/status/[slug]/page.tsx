import { PublicStatusWall } from "@/components/PublicStatusWall";

interface PublicStatusPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublicStatusPage({ params }: PublicStatusPageProps) {
  const { slug } = await params;

  return <PublicStatusWall slug={slug} />;
}

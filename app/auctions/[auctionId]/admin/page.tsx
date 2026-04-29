import { AdminDashboard } from "@/components/AdminDashboard";

type PageProps = {
  params: Promise<{ auctionId: string }>;
};

export default async function AdminPage({ params }: PageProps) {
  const { auctionId } = await params;
  return <AdminDashboard auctionId={auctionId} />;
}

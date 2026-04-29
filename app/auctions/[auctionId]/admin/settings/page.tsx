import { AdminAuctionSettings } from "@/components/AdminAuctionSettings";

type PageProps = {
  params: Promise<{ auctionId: string }>;
};

export default async function AdminSettingsPage({ params }: PageProps) {
  const { auctionId } = await params;
  return <AdminAuctionSettings auctionId={auctionId} />;
}

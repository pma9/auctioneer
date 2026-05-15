import { GuestDashboard } from "@/components/GuestDashboard";

type PageProps = {
  params: Promise<{ auctionId: string }>;
};

export default async function GuestPage({ params }: PageProps) {
  const { auctionId } = await params;
  return <GuestDashboard key={auctionId} auctionId={auctionId} />;
}

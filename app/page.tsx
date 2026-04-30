import { AuctionRulesModal } from "@/components/AuctionRulesModal";
import { HomeIcon } from "lucide-react";
import Link from "next/link";

type PageProps = {
  searchParams?: Promise<{ auctionId?: string | string[] }>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawAuctionId = params?.auctionId;
  const auctionId = Array.isArray(rawAuctionId) ? rawAuctionId[0] : rawAuctionId;
  const guestLoginHref = auctionId ? `/login?auctionId=${encodeURIComponent(auctionId)}` : "/login";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fef3c7,transparent_34%),linear-gradient(135deg,#f8fafc,#e2e8f0)] px-6 py-12 text-slate-950 sm:px-8 lg:px-12">
      <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl flex-col justify-center">
        {auctionId && (
          <Link
            className="mb-8 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
            href="/"
            aria-label="Go to regular homepage"
            title="Go to regular homepage"
          >
            <HomeIcon size={18} />
          </Link>
        )}
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">Auctioneer</p>
        <h1 className="mt-5 max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">
          &quot;Lock-in&quot; hybrid Vickrey auctions.
        </h1>
        <div className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          <p>
            Auctioneer is a new &quot;Hybrid Vickrey&quot; platform by Polo, combining secret bidding with an
            instant &quot;Lock-In&quot; race for a guaranteed win!
          </p>
          <AuctionRulesModal />
        </div>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {!auctionId && (
            <>
              <Link className="button inline-flex" href="/auctions/new">
                Create an auction
              </Link>
              <Link className="button-secondary inline-flex" href="/admin">
                Admin login
              </Link>
            </>
          )}
          <Link
            className={auctionId ? "button inline-flex text-lg" : "button-secondary inline-flex"}
            href={guestLoginHref}
          >
            Guest login
          </Link>
        </div>
      </main>
    </div>
  );
}

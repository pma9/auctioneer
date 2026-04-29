import { AuctionRulesModal } from "@/components/AuctionRulesModal";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fef3c7,transparent_34%),linear-gradient(135deg,#f8fafc,#e2e8f0)] px-6 py-12 text-slate-950 sm:px-8 lg:px-12">
      <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl flex-col justify-center">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">Auctioneer</p>
        <h1 className="mt-5 max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">
          "Lock-in" hybrid Vickrey auctions.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Auctioneer is a new "Hybrid Vickrey" platform by Polo, combining secret bidding with an instant
          "Lock-In" race for a guaranteed win! <AuctionRulesModal />
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link className="button inline-flex" href="/auctions/new">
            Create an auction
          </Link>
          <Link className="button-secondary inline-flex" href="/admin">
            Admin login
          </Link>
          <Link className="button-secondary inline-flex" href="/login">
            Guest login
          </Link>
        </div>
      </main>
    </div>
  );
}

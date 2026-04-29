"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { calculateFinancialSummary, formatCurrency } from "@/lib/auction/calculations";
import type { AuctionItem, Bid } from "@/lib/auction/types";
import { auth, db } from "@/lib/firebase/client";

type Props = {
  auctionId: string;
};

type LockInRequest = {
  item: AuctionItem;
  amount: number;
  errorTarget: "dialog" | "page";
};

export function GuestDashboard({ auctionId }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [activeTab, setActiveTab] = useState<"auction" | "bids">("auction");
  const [selectedItem, setSelectedItem] = useState<AuctionItem | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidError, setBidError] = useState("");
  const [pendingLockIn, setPendingLockIn] = useState<LockInRequest | null>(null);
  const [isLockingIn, setIsLockingIn] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, `auctions/${auctionId}/items`), (snapshot) =>
      setItems(
        snapshot.docs
          .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }) as AuctionItem)
          .filter((item) => item.status === "open" || item.status === "locked"),
      ),
    );
    return unsubItems;
  }, [auctionId]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collectionGroup(db, "bids"), where("auctionId", "==", auctionId), where("uid", "==", user.uid)),
      (snapshot) => setMyBids(snapshot.docs.map((bidDoc) => ({ id: bidDoc.id, ...bidDoc.data() }) as Bid)),
    );
  }, [auctionId, user]);

  const summary = useMemo(() => calculateFinancialSummary(items, myBids), [items, myBids]);
  const bidsByItem = useMemo(() => new Map(myBids.map((bid) => [bid.itemId, bid])), [myBids]);

  async function saveBid(event: FormEvent) {
    event.preventDefault();
    if (!user || !selectedItem) return;
    setBidError("");
    const amount = Number(bidAmount);
    if (!bidAmount.trim() || !Number.isFinite(amount)) {
      setBidError("Enter a valid bid amount.");
      return;
    }
    if (amount < selectedItem.startingPrice) {
      setBidError(`Bid must be at least ${formatCurrency(selectedItem.startingPrice)}.`);
      return;
    }

    await setDoc(
      doc(db, `auctions/${auctionId}/items/${selectedItem.id}/bids/${user.uid}`),
      {
        auctionId,
        itemId: selectedItem.id,
        uid: user.uid,
        bidderName: user.displayName || user.phoneNumber || "Guest",
        amount,
        type: "regular",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    setSelectedItem(null);
    setBidAmount("");
    setBidError("");
  }

  function requestLockIn(item: AuctionItem, amount: number, errorTarget: LockInRequest["errorTarget"]) {
    if (!Number.isFinite(amount)) {
      const error = "Enter a valid bid amount.";
      if (errorTarget === "dialog") setBidError(error);
      else setMessage(error);
      return;
    }
    if (amount < item.lockInPrice) {
      const error = `Lock-in bid must be at least ${formatCurrency(item.lockInPrice)}.`;
      if (errorTarget === "dialog") setBidError(error);
      else setMessage(error);
      return;
    }

    if (errorTarget === "dialog") setBidError("");
    else setMessage("");
    setPendingLockIn({ item, amount, errorTarget });
  }

  async function confirmLockIn() {
    if (!pendingLockIn) return;
    setIsLockingIn(true);
    await lockIn(pendingLockIn.item, pendingLockIn.amount, pendingLockIn.errorTarget);
    setIsLockingIn(false);
    setPendingLockIn(null);
  }

  async function lockIn(item: AuctionItem, amount: number, errorTarget: LockInRequest["errorTarget"]) {
    const token = await user?.getIdToken();
    if (!token) {
      const error = "Sign in first.";
      if (errorTarget === "dialog") setBidError(error);
      else setMessage(error);
      return false;
    }
    const response = await fetch(`/api/auctions/${auctionId}/lock-in`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        itemId: item.id,
        amount,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = result.error ?? "Unable to lock in item.";
      if (errorTarget === "dialog") setBidError(error);
      else setMessage(error);
      return false;
    }

    setMessage("Locked in. You won this item immediately.");
    if (errorTarget === "dialog") {
      setSelectedItem(null);
      setBidAmount("");
      setBidError("");
    }
    return true;
  }

  async function removeBid(bid: Bid) {
    if (bid.type === "locked") return;
    await deleteDoc(doc(db, `auctions/${auctionId}/items/${bid.itemId}/bids/${bid.uid}`));
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="card max-w-md text-center">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-slate-600">Guests must verify their phone before viewing this auction.</p>
          <Link className="button mt-5 inline-flex" href={`/login?auctionId=${auctionId}`}>
            Go to private login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Guest Dashboard</p>
          <h1 className="mt-3 text-3xl font-bold">Auctioneer</h1>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <SummaryCard label="Total Max Commitment" value={formatCurrency(summary.totalMaxCommitment)} />
            <SummaryCard label="Minimum Due" value={formatCurrency(summary.minimumDue)} />
          </div>
        </header>

        <div className="flex rounded-full bg-white p-1 shadow-sm">
          <button
            className={`tab ${activeTab === "auction" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("auction")}
          >
            Auction
          </button>
          <button
            className={`tab ${activeTab === "bids" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("bids")}
          >
            My Bids
          </button>
        </div>

        {message && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}

        {activeTab === "auction" ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const myBid = bidsByItem.get(item.id);
              const lockedByAnotherGuest = item.status === "locked" && item.winnerUid !== user.uid;
              return (
                <motion.article layout className="card flex flex-col gap-4" key={item.id}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {item.status}
                    </p>
                    <h2 className="mt-2 text-xl font-bold">{item.name}</h2>
                    <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                      {item.notes || "No notes provided."}
                    </p>
                  </div>
                  {(myBid || lockedByAnotherGuest) && (
                    <div className="space-y-2">
                      {myBid && (
                        <p
                          className={`rounded-2xl p-3 text-sm font-medium ${
                            myBid.type === "locked"
                              ? "bg-green-50 text-green-800"
                              : "bg-yellow-50 text-yellow-800"
                          }`}
                        >
                          Your bid: {formatCurrency(myBid.amount)} ({myBid.type})
                        </p>
                      )}
                      {lockedByAnotherGuest && (
                        <p className="rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
                          Locked in by {item.winnerName || "another guest"}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-auto space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <Price label="MSRP" value={item.msrp} />
                      <Price label="Start" value={item.startingPrice} />
                      <Price label="Lock" value={item.lockInPrice} />
                    </div>
                    <button
                      className="button w-full"
                      disabled={item.status !== "open"}
                      onClick={() => {
                        setSelectedItem(item);
                        setBidAmount(String(myBid?.amount ?? item.startingPrice));
                        setBidError("");
                      }}
                    >
                      Bid
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </section>
        ) : (
          <section className="space-y-3">
            {myBids.map((bid) => {
              const item = items.find((candidate) => candidate.id === bid.itemId);
              if (!item) return null;
              return (
                <motion.div
                  layout
                  className="card flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
                  key={bid.itemId}
                >
                  <div>
                    <h2 className="text-lg font-bold">{item.name}</h2>
                    <p className="text-sm text-slate-600">
                      {formatCurrency(bid.amount)} {bid.type === "locked" ? "locked in" : "regular bid"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {bid.type === "regular" && (
                      <>
                        <button
                          className="button-secondary"
                          onClick={() => {
                            setSelectedItem(item);
                            setBidAmount(String(bid.amount));
                            setBidError("");
                          }}
                        >
                          Edit
                        </button>
                        <button className="button-secondary" onClick={() => removeBid(bid)}>
                          Remove
                        </button>
                        {bid.amount >= item.lockInPrice && (
                          <button className="button" onClick={() => requestLockIn(item, bid.amount, "page")}>
                            Lock In
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </section>
        )}
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.form
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            onSubmit={saveBid}
          >
            <h2 className="text-2xl font-bold">{selectedItem.name}</h2>
            <p className="mt-2 text-slate-600">{selectedItem.notes || "No notes provided."}</p>
            <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
              <Price label="MSRP" value={selectedItem.msrp} />
              <Price label="Start" value={selectedItem.startingPrice} />
              <Price label="Lock" value={selectedItem.lockInPrice} />
            </div>
            <label className="label mt-5">Your sealed bid</label>
            <input
              className="input"
              type="number"
              value={bidAmount}
              onChange={(event) => {
                setBidAmount(event.target.value);
                setBidError("");
              }}
            />
            {bidError && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{bidError}</p>}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button className="button flex-1" type="submit">
                Save regular bid
              </button>
              {Number(bidAmount) >= selectedItem.lockInPrice && (
                <button
                  className="button-secondary flex-1"
                  type="button"
                  onClick={() => requestLockIn(selectedItem, Number(bidAmount), "dialog")}
                >
                  Lock in now
                </button>
              )}
              <button
                className="button-ghost"
                type="button"
                onClick={() => {
                  setSelectedItem(null);
                  setBidError("");
                }}
              >
                Cancel
              </button>
            </div>
          </motion.form>
        </div>
      )}

      {pendingLockIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-bold">Lock in bid?</h2>
            <p className="mt-3 text-slate-600">
              By locking in this bid, you are going to pay the price that you bid but you are guaranteed the
              item. You are NOT able to edit or remove a locked-in bid, it is final! Do you want to lock-in?
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button className="button flex-1" disabled={isLockingIn} onClick={confirmLockIn}>
                {isLockingIn ? "Locking in..." : "Yes, lock in"}
              </button>
              <button
                className="button-secondary flex-1"
                disabled={isLockingIn}
                onClick={() => setPendingLockIn(null)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Price({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-100 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-semibold">{formatCurrency(value)}</p>
    </div>
  );
}

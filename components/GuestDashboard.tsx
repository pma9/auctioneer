"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import Fuse from "fuse.js";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collection, collectionGroup, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Trash2, X } from "lucide-react";
import { AuctionRulesModal } from "@/components/AuctionRulesModal";
import { SubmittingButton } from "@/components/SubmittingButton";
import { toast } from "sonner";
import { isWholeDollarBid, maxAllowedBidForItem } from "@/lib/auction/bid-limits";
import { calculateFinancialSummary, formatCurrency } from "@/lib/auction/calculations";
import {
  isItemHighlightedForLatestPublishBatch,
  shouldShowNewItemsNotice,
  sortItemsByPublishedAtDesc,
} from "@/lib/auction/item-notifications";
import type { Auction, AuctionItem, Bid, UserAuctionMembership } from "@/lib/auction/types";
import { auth, db } from "@/lib/firebase/client";

type Props = {
  auctionId: string;
};

type LockInRequest = {
  item: AuctionItem;
  amount: number;
  errorTarget: "dialog" | "page";
};

type RemoveBidRequest = {
  bid: Bid;
  item: AuctionItem;
};

type Settlement = {
  winningItems: { item: AuctionItem; bid?: Bid; finalPrice: number }[];
  losingBids: { bid: Bid; item: AuctionItem }[];
  totalOwed: number;
};

type BidRow = {
  bid: Bid;
  item: AuctionItem;
};

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const URL_PREFIX_PATTERN = /^(?:https?:\/\/|www\.)/i;
const TRAILING_URL_PUNCTUATION_PATTERN = /[.,!?;:]+$/;

export function GuestDashboard({ auctionId }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [guestMembership, setGuestMembership] = useState<UserAuctionMembership | null>(null);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [activeTab, setActiveTab] = useState<"auction" | "bids">("auction");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<AuctionItem | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidError, setBidError] = useState("");
  const [pendingLockIn, setPendingLockIn] = useState<LockInRequest | null>(null);
  const [pendingRemoveBid, setPendingRemoveBid] = useState<RemoveBidRequest | null>(null);
  const [isSavingBid, setIsSavingBid] = useState(false);
  const [isLockingIn, setIsLockingIn] = useState(false);
  const [isRemovingBid, setIsRemovingBid] = useState(false);
  const [isDismissingNewItemsNotice, setIsDismissingNewItemsNotice] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const unsubAuction = onSnapshot(doc(db, `auctions/${auctionId}`), (snapshot) => {
      const nextAuction = snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Auction) : null;
      setAuction(nextAuction);
    });
    const itemsQuery = query(
      collection(db, `auctions/${auctionId}/items`),
      where("status", "in", ["open", "locked", "settled"]),
    );
    const unsubItems = onSnapshot(itemsQuery, (snapshot) =>
      setItems(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }) as AuctionItem)),
    );
    return () => {
      unsubAuction();
      unsubItems();
    };
  }, [auctionId]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collectionGroup(db, "bids"), where("auctionId", "==", auctionId), where("uid", "==", user.uid)),
      (snapshot) => setMyBids(snapshot.docs.map((bidDoc) => ({ id: bidDoc.id, ...bidDoc.data() }) as Bid)),
    );
  }, [auctionId, user]);

  useEffect(() => {
    if (!user) return;

    return onSnapshot(doc(db, `users/${user.uid}/auctions/${auctionId}`), (snapshot) => {
      if (!snapshot.exists()) {
        setGuestMembership(null);
        return;
      }
      const data = snapshot.data() as UserAuctionMembership;
      setGuestMembership({ ...data });
    });
  }, [auctionId, user]);

  const isAuctionOpen = auction?.status === "open";
  const isAuctionPending = auction?.status === "pending";
  const isAuctionSettling = auction?.status === "settling";
  const isAuctionClosed = auction?.status === "closed";
  const biddingUnavailableMessage = isAuctionPending
    ? "Bidding has not opened yet. You can browse items until the auction opens."
    : isAuctionSettling
      ? "This auction is being closed out. Bids can no longer be changed."
      : "This auction is closed. Bids can no longer be changed.";
  const guestDisplayName = guestMembership?.displayName?.trim() || "Guest";
  const activeItems = useMemo(
    () => items.filter((item) => item.status === "open" || item.status === "locked"),
    [items],
  );
  const sortedActiveItems = useMemo(() => sortItemsByPublishedAtDesc(activeItems), [activeItems]);
  const bidsByItem = useMemo(() => new Map(myBids.map((bid) => [bid.itemId, bid])), [myBids]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const bidRows = useMemo(
    () =>
      myBids
        .map((bid) => ({ bid, item: itemsById.get(bid.itemId) }))
        .filter((row): row is BidRow => Boolean(row.item)),
    [itemsById, myBids],
  );
  const currentBidRows = useMemo(
    () => bidRows.filter(({ item }) => !isLockedByAnotherGuest(item, user?.uid)),
    [bidRows, user?.uid],
  );
  const invalidBidRows = useMemo(
    () => bidRows.filter(({ item }) => isLockedByAnotherGuest(item, user?.uid)),
    [bidRows, user?.uid],
  );
  const trimmedSearchQuery = searchQuery.trim();
  const activeItemsFuse = useMemo(
    () =>
      new Fuse(sortedActiveItems, {
        keys: ["name", "notes", "keywords"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [sortedActiveItems],
  );
  const currentBidRowsFuse = useMemo(
    () =>
      new Fuse(currentBidRows, {
        keys: ["item.name", "item.notes", "item.keywords"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [currentBidRows],
  );
  const invalidBidRowsFuse = useMemo(
    () =>
      new Fuse(invalidBidRows, {
        keys: ["item.name", "item.notes", "item.keywords"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [invalidBidRows],
  );
  const filteredActiveItems = useMemo(() => {
    const matched = trimmedSearchQuery
      ? activeItemsFuse.search(trimmedSearchQuery).map((result) => result.item)
      : sortedActiveItems;
    return sortItemsByPublishedAtDesc(matched);
  }, [sortedActiveItems, activeItemsFuse, trimmedSearchQuery]);
  const filteredCurrentBidRows = useMemo(
    () =>
      trimmedSearchQuery
        ? currentBidRowsFuse.search(trimmedSearchQuery).map((result) => result.item)
        : currentBidRows,
    [currentBidRows, currentBidRowsFuse, trimmedSearchQuery],
  );
  const filteredInvalidBidRows = useMemo(
    () =>
      trimmedSearchQuery
        ? invalidBidRowsFuse.search(trimmedSearchQuery).map((result) => result.item)
        : invalidBidRows,
    [invalidBidRows, invalidBidRowsFuse, trimmedSearchQuery],
  );
  const currentBids = useMemo(() => currentBidRows.map(({ bid }) => bid), [currentBidRows]);
  const summary = useMemo(
    () => calculateFinancialSummary(activeItems, currentBids),
    [activeItems, currentBids],
  );
  const settlement = useMemo(() => {
    const winningItems = items
      .filter(
        (item) => (item.status === "settled" || item.status === "locked") && item.winnerUid === user?.uid,
      )
      .map((item) => ({
        item,
        bid: bidsByItem.get(item.id),
        finalPrice: item.finalPrice ?? item.winningBid ?? 0,
      }));
    const winningItemIds = new Set(winningItems.map(({ item }) => item.id));
    const losingBids = myBids
      .filter((bid) => !winningItemIds.has(bid.itemId))
      .map((bid) => ({ bid, item: itemsById.get(bid.itemId) }))
      .filter((row): row is { bid: Bid; item: AuctionItem } => Boolean(row.item));

    return {
      winningItems,
      losingBids,
      totalOwed: winningItems.reduce((total, row) => total + row.finalPrice, 0),
    };
  }, [bidsByItem, items, itemsById, myBids, user?.uid]);

  async function saveBid(event: FormEvent) {
    event.preventDefault();
    if (isSavingBid) return;
    if (!user || !selectedItem) return;
    setBidError("");
    if (!isAuctionOpen) {
      setBidError(biddingUnavailableMessage);
      return;
    }
    const amount = Number(bidAmount);
    if (!bidAmount.trim() || !Number.isFinite(amount)) {
      setBidError("Enter a valid bid amount.");
      return;
    }
    const amountError = bidAmountErrorForItem(selectedItem, amount, selectedItem.startingPrice, "Bid");
    if (amountError) {
      setBidError(amountError);
      return;
    }

    setIsSavingBid(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/auctions/${auctionId}/bids`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          amount,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setBidError(result.error ?? "Unable to save bid.");
        return;
      }

      setSelectedItem(null);
      setBidAmount("");
      setBidError("");
    } catch (error) {
      setBidError(error instanceof Error ? error.message : "Unable to save bid.");
    } finally {
      setIsSavingBid(false);
    }
  }

  function requestLockIn(item: AuctionItem, amount: number, errorTarget: LockInRequest["errorTarget"]) {
    if (!isAuctionOpen) {
      const error = biddingUnavailableMessage;
      if (errorTarget === "dialog") setBidError(error);
      else toast(error);
      return;
    }
    if (!Number.isFinite(amount)) {
      const error = "Enter a valid bid amount.";
      if (errorTarget === "dialog") setBidError(error);
      else toast(error);
      return;
    }
    const amountError = bidAmountErrorForItem(item, amount, item.lockInPrice, "Lock-in bid");
    if (amountError) {
      if (errorTarget === "dialog") setBidError(amountError);
      else toast(amountError);
      return;
    }

    if (errorTarget === "dialog") setBidError("");
    else toast.dismiss();
    setPendingLockIn({ item, amount, errorTarget });
  }

  async function confirmLockIn() {
    if (isLockingIn) return;
    if (!pendingLockIn) return;
    setIsLockingIn(true);
    try {
      await lockIn(pendingLockIn.item, pendingLockIn.amount, pendingLockIn.errorTarget);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to lock in item.");
    } finally {
      setIsLockingIn(false);
      setPendingLockIn(null);
    }
  }

  async function lockIn(item: AuctionItem, amount: number, errorTarget: LockInRequest["errorTarget"]) {
    const token = await user?.getIdToken();
    if (!token) {
      const error = "Sign in first.";
      if (errorTarget === "dialog") setBidError(error);
      else toast(error);
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
      else toast(error);
      return false;
    }

    toast("Locked in. You won this item immediately.");
    if (errorTarget === "dialog") {
      setSelectedItem(null);
      setBidAmount("");
      setBidError("");
    }
    return true;
  }

  async function confirmRemoveBid() {
    if (isRemovingBid) return;
    if (!pendingRemoveBid) return;
    setIsRemovingBid(true);
    try {
      const removed = await removeBid(pendingRemoveBid.bid);
      if (removed) setPendingRemoveBid(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to remove bid.");
    } finally {
      setIsRemovingBid(false);
    }
  }

  async function removeBid(bid: Bid) {
    if (!isAuctionOpen) {
      toast(biddingUnavailableMessage);
      return false;
    }
    if (bid.type === "locked") return false;

    const token = await user?.getIdToken();
    if (!token) {
      toast("Sign in first.");
      return false;
    }
    const response = await fetch(`/api/auctions/${auctionId}/bids`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ itemId: bid.itemId }),
    });
    const result = await response.json();
    if (!response.ok) {
      toast(result.error ?? "Unable to remove bid.");
      return false;
    }

    toast("Bid removed.");
    return true;
  }

  async function logout() {
    await signOut(auth);
    router.replace("/");
  }

  async function dismissNewItemsNotice() {
    if (!user || auction?.latestItemsPublishedAt == null || isDismissingNewItemsNotice) return;
    setIsDismissingNewItemsNotice(true);
    try {
      await updateDoc(doc(db, `users/${user.uid}/auctions/${auctionId}`), {
        newItemsNotificationDismissedAt: auction.latestItemsPublishedAt,
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to dismiss notification.");
    } finally {
      setIsDismissingNewItemsNotice(false);
    }
  }

  const showNewItemsNotice =
    Boolean(auction) &&
    shouldShowNewItemsNotice(
      auction?.latestItemsPublishedAt,
      guestMembership?.newItemsNotificationDismissedAt,
    );

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
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
            {guestDisplayName}&apos;s Dashboard
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="lg:min-w-0">
              <h1 className="text-3xl font-bold">
                {auction ? `${auction.title} hosted by ${auction.adminDisplayName}` : "Auction"}
              </h1>
              {!isAuctionClosed && auction?.auctionNotes && (
                <LinkifiedNotes
                  className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-200"
                  linkClassName="font-semibold text-amber-200 underline decoration-amber-200/70 underline-offset-2"
                  text={auction.auctionNotes}
                />
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
              <AuctionRulesModal
                className="button-light inline-flex w-full text-lg sm:w-auto"
                label="Help"
                trigger="button"
              />
              <button className="button-light w-full text-lg sm:w-auto" onClick={logout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        {isAuctionClosed && (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-5">
            <p className="text-md font-semibold uppercase tracking-[0.2em] text-red-700">Auction Closed</p>
            {auction?.closingNotes && (
              <LinkifiedNotes
                className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700"
                linkClassName="font-semibold text-red-700 underline decoration-red-700/60 underline-offset-2"
                text={auction.closingNotes}
              />
            )}
          </section>
        )}

        {isAuctionPending && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-md font-semibold uppercase tracking-[0.2em] text-amber-700">Auction Pending</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              You can browse published items now. Bidding will be available once the admin opens the auction.
              Draft items are visible only to admins until published.
            </p>
          </section>
        )}

        {isAuctionSettling && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-md font-semibold uppercase tracking-[0.2em] text-amber-700">Auction Closing</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              The admin is closing out the auction. Bids are frozen while final prices are calculated.
            </p>
          </section>
        )}

        {typeof document !== "undefined" &&
          showNewItemsNotice &&
          createPortal(
            <div
              aria-labelledby="new-items-dialog-title"
              aria-modal="true"
              className="fixed inset-0 z-[100] flex min-h-[100dvh] w-full max-w-[100vw] items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:min-h-screen"
              role="dialog"
            >
              <motion.div
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="w-full max-w-lg rounded-3xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-8 shadow-2xl sm:p-10"
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
              >
                <div className="flex flex-col items-center text-center">
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-800">Heads up</p>
                  <h2
                    className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl"
                    id="new-items-dialog-title"
                  >
                    New items are added
                  </h2>
                  <p className="mt-4 max-w-sm text-base leading-relaxed text-slate-600">
                    Check the auction list — new listings are highlighted and sorted to the top by publish
                    date.
                  </p>
                  <button
                    className="button mt-8 w-full max-w-xs text-lg py-4 sm:text-xl disabled:opacity-60"
                    disabled={isDismissingNewItemsNotice}
                    type="button"
                    onClick={() => void dismissNewItemsNotice()}
                  >
                    {isDismissingNewItemsNotice ? "Saving…" : "Got it"}
                  </button>
                </div>
              </motion.div>
            </div>,
            document.body,
          )}

        <section className="grid gap-3 grid-cols-2">
          {isAuctionClosed ? (
            <>
              <SummaryCard label="Amount Due" value={formatCurrency(settlement.totalOwed)} />
              <SummaryCard label="Items Won" value={String(settlement.winningItems.length)} />
            </>
          ) : (
            <>
              <SummaryCard label="Minimum Due" value={formatCurrency(summary.minimumDue)} />
              <SummaryCard label="Total Max Commitment" value={formatCurrency(summary.totalMaxCommitment)} />
            </>
          )}
        </section>

        {!isAuctionClosed && (
          <div className="sticky top-0 z-20 -mx-4 space-y-3 bg-slate-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
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
            <div className="relative">
              <input
                aria-label={activeTab === "auction" ? "Search auction items" : "Search my bids"}
                className="input pr-12"
                enterKeyHint="done"
                placeholder={
                  activeTab === "auction"
                    ? "Search auction items by name, description, or keyword"
                    : "Search my bids by item, description, or keyword"
                }
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              {searchQuery && (
                <button
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  type="button"
                  onClick={() => setSearchQuery("")}
                >
                  <X aria-hidden="true" size={18} />
                </button>
              )}
            </div>
          </div>
        )}

        {isAuctionClosed ? (
          <ClosedSettlement settlement={settlement} />
        ) : activeTab === "auction" ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredActiveItems.map((item) => {
              const myBid = bidsByItem.get(item.id);
              const lockedByAnotherGuest = isLockedByAnotherGuest(item, user.uid);
              const isNewHighlight = isItemHighlightedForLatestPublishBatch(
                item,
                auction?.latestItemsPublishedAt,
              );
              return (
                <motion.article
                  layout
                  className={`card flex flex-col gap-4 ${isNewHighlight ? "ring-2 ring-amber-400/70 border-amber-200 bg-amber-50/40" : ""}`}
                  key={item.id}
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {item.status}
                      {isNewHighlight ? (
                        <span className="ml-2 rounded-full bg-amber-200/80 px-2 py-0.5 text-[0.65rem] font-bold tracking-normal text-amber-950">
                          New
                        </span>
                      ) : null}
                    </p>
                    <h2 className="mt-2 text-xl font-bold">{item.name}</h2>
                    <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                      {item.notes || "No notes provided."}
                    </p>
                  </div>
                  {(myBid || lockedByAnotherGuest) && (
                    <div className="space-y-2">
                      {myBid && !lockedByAnotherGuest && (
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
                      disabled={!isAuctionOpen || item.status !== "open"}
                      onClick={() => {
                        setSelectedItem(item);
                        setBidAmount(String(myBid?.amount ?? ""));
                        setBidError("");
                      }}
                    >
                      Bid
                    </button>
                  </div>
                </motion.article>
              );
            })}
            {!filteredActiveItems.length && (
              <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm md:col-span-2 xl:col-span-3">
                {trimmedSearchQuery
                  ? "No auction items match your search."
                  : "No auction items are available."}
              </p>
            )}
          </section>
        ) : (
          <section className="space-y-6">
            <div className="space-y-3">
              {filteredCurrentBidRows.length ? (
                filteredCurrentBidRows.map(({ bid, item }) => {
                  const itemLockUnavailableReason = !isAuctionOpen
                    ? biddingUnavailableMessage
                    : item.status !== "open"
                      ? "Item is not open for bidding."
                      : "";
                  const lockInDisabledReason =
                    itemLockUnavailableReason ||
                    (bid.amount < item.lockInPrice ? lockInDisabledMessage(item) : "");
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
                              aria-label={`Edit bid for ${item.name}`}
                              className="inline-flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 hover:text-slate-950"
                              disabled={!isAuctionOpen}
                              title="Edit bid"
                              type="button"
                              onClick={() => {
                                setSelectedItem(item);
                                setBidAmount(String(bid.amount));
                                setBidError("");
                              }}
                            >
                              <Pencil aria-hidden="true" size={18} />
                            </button>
                            <button
                              aria-label={`Remove bid for ${item.name}`}
                              className="inline-flex size-10 items-center justify-center rounded-full bg-red-50 text-red-700 transition hover:bg-red-100 hover:text-red-800"
                              disabled={!isAuctionOpen}
                              title="Remove bid"
                              type="button"
                              onClick={() => setPendingRemoveBid({ bid, item })}
                            >
                              <Trash2 aria-hidden="true" size={18} />
                            </button>
                            <span title={itemLockUnavailableReason}>
                              <button
                                aria-label={`Lock in minimum ${formatCurrency(item.lockInPrice)} bid for ${item.name}`}
                                className="inline-flex h-10 items-center justify-center gap-1 rounded-full bg-amber-100 px-3 text-sm font-bold text-amber-800 transition hover:bg-amber-200 hover:text-amber-900"
                                disabled={Boolean(itemLockUnavailableReason)}
                                title={itemLockUnavailableReason || "Lock in at minimum price"}
                                type="button"
                                onClick={() => requestLockIn(item, item.lockInPrice, "page")}
                              >
                                Min
                                <Lock aria-hidden="true" size={15} />
                              </button>
                            </span>
                            <span title={lockInDisabledReason}>
                              <button
                                aria-label={`Lock in ${formatCurrency(bid.amount)} bid for ${item.name}`}
                                className="inline-flex size-10 items-center justify-center rounded-full bg-green-100 text-green-800 transition hover:bg-green-200 hover:text-green-900"
                                disabled={Boolean(lockInDisabledReason)}
                                title={lockInDisabledReason || "Lock in current bid"}
                                type="button"
                                onClick={() => requestLockIn(item, bid.amount, "page")}
                              >
                                <Lock aria-hidden="true" size={18} />
                              </button>
                            </span>
                          </>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              ) : (
                <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">
                  {trimmedSearchQuery
                    ? "No current bids match your search."
                    : "You have no current bids for this auction."}
                </p>
              )}
            </div>

            {filteredInvalidBidRows.length > 0 && (
              <div className="space-y-3">
                <div className="px-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">
                    Invalid Bids
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    These bids are no longer active because another guest locked in the item.
                  </p>
                </div>
                {filteredInvalidBidRows.map(({ bid, item }) => (
                  <motion.div
                    layout
                    className="card flex flex-col gap-1 border-red-100 bg-red-50/60"
                    key={bid.itemId}
                  >
                    <h2 className="text-lg font-bold">{item.name}</h2>
                    <p className="text-sm text-slate-600">Your bid: {formatCurrency(bid.amount)}</p>
                    <p className="text-sm text-slate-600">
                      Locked in by {item.winnerName || "another guest"}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.form
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            noValidate
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
              aria-describedby={bidError ? "bid-amount-error" : "bid-amount-help"}
              aria-invalid={Boolean(bidError)}
              className={`input ${bidError ? "border-red-300 bg-red-50/60 focus:border-red-500 focus:ring-red-500" : ""}`}
              max={maxAllowedBidForItem(selectedItem)}
              min={selectedItem.startingPrice}
              step="1"
              type="number"
              value={bidAmount}
              onChange={(event) => {
                setBidAmount(event.target.value);
                setBidError("");
              }}
            />
            {bidError ? (
              <p
                className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700 shadow-sm"
                id="bid-amount-error"
                role="alert"
              >
                {bidError}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500" id="bid-amount-help">
                Regular bids &gt;= {formatCurrency(selectedItem.startingPrice)} | Lock-in bid &gt;={" "}
                {formatCurrency(selectedItem.lockInPrice)}.
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={isSavingBid}
                submittingLabel="Saving..."
                type="submit"
              >
                Save regular bid
              </SubmittingButton>
              <span
                className="flex-1"
                title={
                  Number(bidAmount) < selectedItem.lockInPrice
                    ? lockInDisabledMessage(selectedItem)
                    : !isAuctionOpen
                      ? biddingUnavailableMessage
                      : ""
                }
              >
                <button
                  className="button-secondary w-full"
                  disabled={isSavingBid || !isAuctionOpen || Number(bidAmount) < selectedItem.lockInPrice}
                  type="button"
                  onClick={() => requestLockIn(selectedItem, Number(bidAmount), "dialog")}
                >
                  Lock in now
                </button>
              </span>
              <button
                className="button-ghost"
                disabled={isSavingBid}
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

      {pendingRemoveBid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-bold">Are you sure?</h2>
            <p className="mt-2 font-semibold text-slate-950">{pendingRemoveBid.item.name}</p>
            <p className="mt-3 text-slate-600">
              This will remove your current {formatCurrency(pendingRemoveBid.bid.amount)} bid. You can place a
              new bid later while the auction is still open.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="flex-1 rounded-full bg-red-600 px-5 py-3 font-bold text-white transition hover:bg-red-700"
                isSubmitting={isRemovingBid}
                submittingLabel="Removing..."
                onClick={confirmRemoveBid}
              >
                Yes, remove bid
              </SubmittingButton>
              <button
                className="button-secondary flex-1"
                disabled={isRemovingBid}
                onClick={() => setPendingRemoveBid(null)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {pendingLockIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-bold">Lock in {formatCurrency(pendingLockIn.amount)} bid?</h2>
            <p className="mt-2 font-semibold text-slate-950">{pendingLockIn.item.name}</p>
            <p className="mt-3 text-slate-600">
              By locking in this bid, you are going to pay{" "}
              <strong>{formatCurrency(pendingLockIn.amount)}</strong> but you are guaranteed the item. You are
              NOT able to edit or remove a locked-in bid, it is final! Do you want to lock-in?
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={isLockingIn}
                submittingLabel="Locking in..."
                onClick={confirmLockIn}
              >
                Yes, lock in
              </SubmittingButton>
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
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
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

function bidAmountErrorForItem(item: AuctionItem, amount: number, minimumAmount: number, label: string) {
  if (!isWholeDollarBid(amount)) return `${label}s must be whole dollar amounts.`;
  if (amount < minimumAmount) return `${label} must be at least ${formatCurrency(minimumAmount)}.`;

  const maxAllowedBid = maxAllowedBidForItem(item);
  if (amount > maxAllowedBid) return "Bid seems a little high! It's way over MSRP";

  return "";
}

function lockInDisabledMessage(item: AuctionItem) {
  return `The bid must be >= ${formatCurrency(item.lockInPrice)}`;
}

function isLockedByAnotherGuest(item: AuctionItem, uid?: string) {
  return Boolean(uid) && item.status === "locked" && item.winnerUid !== uid;
}

function LinkifiedNotes({
  className,
  linkClassName,
  text,
}: {
  className: string;
  linkClassName: string;
  text: string;
}) {
  return (
    <p className={className}>
      {text.split(URL_PATTERN).map((part, index) => {
        if (!URL_PREFIX_PATTERN.test(part)) return part;

        const trailingPunctuation = part.match(TRAILING_URL_PUNCTUATION_PATTERN)?.[0] ?? "";
        const urlText = trailingPunctuation ? part.slice(0, -trailingPunctuation.length) : part;
        const href = urlText.startsWith("www.") ? `https://${urlText}` : urlText;

        return (
          <span key={`${urlText}-${index}`}>
            <a className={linkClassName} href={href} rel="noopener noreferrer" target="_blank">
              {urlText}
            </a>
            {trailingPunctuation}
          </span>
        );
      })}
    </p>
  );
}

function ClosedSettlement({ settlement }: { settlement: Settlement }) {
  return (
    <section className="space-y-6">
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Settlement</p>
            <h2 className="mt-2 text-2xl font-bold">Winning bids</h2>
          </div>
          <p className="text-sm text-slate-600">{settlement.winningItems.length} item(s) won</p>
        </div>
        {settlement.winningItems.length ? (
          <div className="mt-5">
            <table className="w-full table-fixed text-left text-xs sm:text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="w-auto py-2 pr-2 sm:py-3">Item</th>
                  <th className="w-20 py-2 pr-2 text-right sm:w-24 sm:py-3">Your bid</th>
                  <th className="w-24 py-2 text-right sm:w-28 sm:py-3">
                    <span className="group relative inline-flex cursor-help items-center gap-1" tabIndex={0}>
                      Final price
                      <span
                        className="pointer-events-none absolute right-0 top-7 z-10 hidden w-72 rounded-2xl bg-slate-950 p-3 text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus:block"
                        role="tooltip"
                      >
                        The final price is the second-highest bid, or the starting price when there was no
                        second bid. Lock-in wins pay the lock-in bid amount.
                      </span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settlement.winningItems.map(({ item, bid, finalPrice }) => (
                  <tr className="border-t border-slate-100" key={item.id}>
                    <td className="py-2 pr-2 align-top font-medium leading-5 text-slate-900 sm:py-3">
                      <span className="block whitespace-normal wrap-break-word">{item.name}</span>
                    </td>
                    <td className="py-2 pr-2 text-right align-top whitespace-nowrap text-slate-700 sm:py-3">
                      <span className="inline-flex items-center justify-end gap-1">
                        {bid?.type === "locked" ? (
                          <Lock className="h-3.5 w-3.5 text-slate-500" aria-label="Locked in" />
                        ) : null}
                        <span>{formatCurrency(bid?.amount ?? item.winningBid ?? 0)}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right align-top whitespace-nowrap font-semibold text-green-700 sm:py-3">
                      {formatCurrency(finalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            You did not win any items in this auction.
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <h2 className="text-2xl font-bold">Losing bids</h2>
        {settlement.losingBids.length ? (
          <div className="mt-5">
            <table className="w-full table-fixed text-left text-xs sm:text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="w-auto py-2 pr-2 sm:py-3">Item</th>
                  <th className="w-20 py-2 pr-2 text-right sm:w-24 sm:py-3">Your bid</th>
                </tr>
              </thead>
              <tbody>
                {settlement.losingBids.map(({ item, bid }) => (
                  <tr className="border-t border-slate-100" key={bid.itemId}>
                    <td className="py-2 pr-2 align-top font-medium leading-5 text-slate-900 sm:py-3">
                      <span className="block whitespace-normal wrap-break-word">{item.name}</span>
                    </td>
                    <td className="py-2 pr-2 text-right align-top whitespace-nowrap text-slate-700 sm:py-3">
                      {formatCurrency(bid.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            You have no losing bids for this auction.
          </p>
        )}
      </div>
    </section>
  );
}

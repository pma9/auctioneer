"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { signOut } from "firebase/auth";
import { motion } from "framer-motion";
import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Menu,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SubmittingButton } from "@/components/SubmittingButton";
import { calculateVickreyBreakdown, formatCurrency, normalizeItemName } from "@/lib/auction/calculations";
import { auctionItemValidationErrors } from "@/lib/auction/item-validation";
import {
  allSelectedPublishable,
  allSelectedUnpublishable,
  canPublishItem,
  canUnpublishItem,
  itemFormWouldBeValid,
  publishableDraftItems,
} from "@/lib/auction/item-publish";
import type { Auction, AuctionItem, Bid } from "@/lib/auction/types";
import { auth, db } from "@/lib/firebase/client";
import { useRequiredFirebaseUser } from "@/components/useRequiredFirebaseUser";

type Props = {
  auctionId: string;
};

const emptyItemForm = {
  name: "",
  notes: "",
  keywords: "",
  msrp: "",
  startingPrice: "0",
  lockInPrice: "0",
};

type ItemForm = typeof emptyItemForm;
type AdminTab = "current" | "all";
type AdminSubmission =
  | "item"
  | "open"
  | "settle"
  | "reopen"
  | "bulkPublish"
  | "bulkUnpublish"
  | "bulkRemove"
  | "publishAll";

const FIRESTORE_BATCH_SAFE = 450;

async function commitBatchedUpdates(
  firestore: Firestore,
  ops: { ref: ReturnType<typeof doc>; data: UpdateData<DocumentData> }[],
) {
  for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_SAFE) {
    const batch = writeBatch(firestore);
    for (const op of ops.slice(i, i + FIRESTORE_BATCH_SAFE)) {
      batch.update(op.ref, op.data);
    }
    await batch.commit();
  }
}

export function AdminDashboard({ auctionId }: Props) {
  const router = useRouter();
  const user = useRequiredFirebaseUser();
  const [auction, setAuction] = useState<Auction | null>(null);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [activeTab, setActiveTab] = useState<AdminTab>("current");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedWinnerUids, setExpandedWinnerUids] = useState<Set<string>>(() => new Set());
  const [showRemovedItems, setShowRemovedItems] = useState(false);
  const [showInvalidItems, setShowInvalidItems] = useState(true);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [editingItem, setEditingItem] = useState<AuctionItem | null>(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<AdminSubmission | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [mobileFabOpen, setMobileFabOpen] = useState(false);
  const [isPublishAllModalOpen, setIsPublishAllModalOpen] = useState(false);
  const [bulkConfirmModal, setBulkConfirmModal] = useState<null | "publish" | "unpublish" | "delete">(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;

    const unsubAuction = onSnapshot(doc(db, `auctions/${auctionId}`), (snapshot) =>
      setAuction(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Auction) : null),
    );
    const unsubItems = onSnapshot(collection(db, `auctions/${auctionId}/items`), (snapshot) =>
      setItems(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }) as AuctionItem)),
    );
    const unsubBids = onSnapshot(
      query(collectionGroup(db, "bids"), where("auctionId", "==", auctionId)),
      (snapshot) => setBids(snapshot.docs.map((bidDoc) => ({ id: bidDoc.id, ...bidDoc.data() }) as Bid)),
    );
    return () => {
      unsubAuction();
      unsubItems();
      unsubBids();
    };
  }, [auctionId, user]);

  const analytics = useMemo(() => {
    const bidsByItem = new Map<string, Bid[]>();
    bids.forEach((bid) => bidsByItem.set(bid.itemId, [...(bidsByItem.get(bid.itemId) ?? []), bid]));
    const includeSettled = auction?.status === "settling" || auction?.status === "closed";
    const bidItems = items.filter((item) => {
      if (item.status === "open" || item.status === "locked") return true;
      if (includeSettled && item.status === "settled") return true;
      return false;
    });
    const rows = bidItems.map((item) => calculateVickreyBreakdown(item, bidsByItem.get(item.id) ?? []));
    const rowsByItemId = new Map(rows.map((row) => [row.item.id, row]));
    return {
      rows,
      rowsByItemId,
      bidsByItem,
      currentRows: rows.filter((row) => row.topBid),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      totalBids: bids.length,
      totalItems: items.length,
      invalidItems: items.filter((item) => item.status === "invalid").length,
      itemsWithBids: items.filter((item) => bidsByItem.has(item.id)).length,
      lockedInBids: bids.filter((bid) => bid.type === "locked").length,
    };
  }, [auction?.status, bids, items]);

  const settlement = useMemo(() => {
    const winnersByUid = new Map<
      string,
      { uid: string; displayName: string; items: { item: AuctionItem; owed: number }[]; totalOwed: number }
    >();

    for (const item of items) {
      if (item.status !== "locked" && item.status !== "settled") continue;
      if (!item.winnerUid) continue;
      const owed = item.finalPrice ?? item.winningBid ?? 0;
      const displayName = item.winnerName ?? "Guest";

      const existing = winnersByUid.get(item.winnerUid) ?? {
        uid: item.winnerUid,
        displayName,
        items: [],
        totalOwed: 0,
      };
      existing.items.push({ item, owed });
      existing.totalOwed += owed;
      if (!existing.displayName && displayName) existing.displayName = displayName;
      winnersByUid.set(item.winnerUid, existing);
    }

    const winners = [...winnersByUid.values()]
      .map((winner) => ({
        ...winner,
        items: [...winner.items].sort((a, b) => b.owed - a.owed),
      }))
      .sort((a, b) => b.totalOwed - a.totalOwed);

    return {
      winners,
      totalRevenue: winners.reduce((sum, winner) => sum + winner.totalOwed, 0),
      totalItems: winners.reduce((sum, winner) => sum + winner.items.length, 0),
    };
  }, [items]);

  function toggleWinnerExpanded(uid: string) {
    setExpandedWinnerUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (submittingAction === "item") return;
    if (!itemFormWouldBeValid(itemForm)) {
      toast("Item name, starting price, and lock-in price are required.");
      return;
    }

    const payload = {
      name: itemForm.name.trim(),
      notes: itemForm.notes.trim(),
      keywords: itemForm.keywords.trim(),
      msrp: Number(itemForm.msrp || 0),
      startingPrice: Number(itemForm.startingPrice),
      lockInPrice: Number(itemForm.lockInPrice),
      normalizedName: normalizeItemName(itemForm.name),
      updatedAt: serverTimestamp(),
    };

    setSubmittingAction("item");
    try {
      if (editingItem) {
        const statusPatch: Record<string, string> = {};
        if (editingItem.status === "invalid" || editingItem.status === "removed") {
          statusPatch.status = "draft";
        }
        await updateDoc(doc(db, `auctions/${auctionId}/items/${editingItem.id}`), {
          ...payload,
          importValidationErrors: deleteField(),
          ...statusPatch,
        });
      } else {
        const itemRef = doc(collection(db, `auctions/${auctionId}/items`));
        await setDoc(itemRef, {
          ...payload,
          status: "draft",
          createdAt: serverTimestamp(),
        });
      }

      closeItemModal();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to save item.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function settleAuction() {
    if (submittingAction === "settle") return;
    setSubmittingAction("settle");
    try {
      const token = await user?.getIdToken();
      if (!token) return toast("Sign in as an auction admin first.");
      const response = await fetch(`/api/auctions/${auctionId}/settle`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      toast(response.ok ? "Auction settled." : result.error);
      if (response.ok) setIsSettleModalOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to settle auction.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function openAuction() {
    if (submittingAction === "open") return;
    setSubmittingAction("open");
    try {
      const token = await user?.getIdToken();
      if (!token) return toast("Sign in as an auction admin first.");
      const response = await fetch(`/api/auctions/${auctionId}/open`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      toast(response.ok ? "Auction opened." : result.error);
      if (response.ok) setIsOpenModalOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to open auction.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function reopenAuction() {
    if (submittingAction === "reopen") return;
    setSubmittingAction("reopen");
    try {
      const token = await user?.getIdToken();
      if (!token) return toast("Sign in as an auction admin first.");
      const response = await fetch(`/api/auctions/${auctionId}/reopen`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      toast(response.ok ? "Auction re-opened." : result.error);
      if (response.ok) setIsReopenModalOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to re-open auction.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function copyGuestLoginLink() {
    const guestLoginUrl = new URL("/", window.location.origin);
    guestLoginUrl.searchParams.set("auctionId", auctionId);

    try {
      await navigator.clipboard.writeText(guestLoginUrl.toString());
      toast("Guest login link copied.");
    } catch {
      toast("Could not copy guest login link.");
    }
  }

  async function logout() {
    await signOut(auth);
    router.replace("/");
  }

  function openNewItemModal() {
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setIsItemModalOpen(true);
  }

  function openEditItemModal(item: AuctionItem) {
    setEditingItem(item);
    const needsStartingPrice = item.importValidationErrors?.some((error) =>
      error.startsWith("Starting price"),
    );
    const needsLockInPrice = item.importValidationErrors?.some((error) => error.startsWith("Lock-in price"));
    setItemForm({
      name: item.name,
      notes: item.notes ?? "",
      keywords: item.keywords ?? "",
      msrp: item.msrp ? String(item.msrp) : "",
      startingPrice: needsStartingPrice ? "" : String(item.startingPrice ?? 0),
      lockInPrice: needsLockInPrice ? "" : String(item.lockInPrice ?? 0),
    });
    setIsItemModalOpen(true);
  }

  function closeItemModal() {
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setIsItemModalOpen(false);
  }

  async function removeItem(item: AuctionItem) {
    const row = analytics.rowsByItemId.get(item.id);
    if (isLockedIn(item, row?.topBid)) {
      const confirmed = window.confirm(`${item.name} is locked in. Remove it anyway?`);
      if (!confirmed) return;
    }

    await updateDoc(doc(db, `auctions/${auctionId}/items/${item.id}`), {
      status: "removed",
      updatedAt: serverTimestamp(),
    });
  }

  async function restoreItem(item: AuctionItem) {
    const errors = auctionItemValidationErrors(item);
    await updateDoc(doc(db, `auctions/${auctionId}/items/${item.id}`), {
      status: errors.length ? "invalid" : "draft",
      importValidationErrors: errors.length ? errors : deleteField(),
      updatedAt: serverTimestamp(),
    });
  }

  const allTableItems = items
    .filter((item) => {
      if (!showRemovedItems && item.status === "removed") return false;
      if (!showInvalidItems && item.status === "invalid") return false;
      return true;
    })
    .sort((a, b) => Number(b.status === "invalid") - Number(a.status === "invalid"));
  const trimmedSearchQuery = searchQuery.trim();
  const currentRowsFuse = useMemo(
    () =>
      new Fuse(analytics.currentRows, {
        keys: ["item.name", "item.notes", "item.keywords", "topBid.bidderName", "secondBid.bidderName"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [analytics.currentRows],
  );
  const allItemsFuse = useMemo(
    () =>
      new Fuse(allTableItems, {
        keys: ["name", "notes", "keywords"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [allTableItems],
  );
  const filteredCurrentRows = useMemo(
    () =>
      trimmedSearchQuery
        ? currentRowsFuse.search(trimmedSearchQuery).map((result) => result.item)
        : analytics.currentRows,
    [analytics.currentRows, currentRowsFuse, trimmedSearchQuery],
  );
  const filteredAllTableItems = useMemo(
    () =>
      trimmedSearchQuery
        ? allItemsFuse.search(trimmedSearchQuery).map((result) => result.item)
        : allTableItems,
    [allItemsFuse, allTableItems, trimmedSearchQuery],
  );

  const visibleIdSet = useMemo(
    () => new Set(filteredAllTableItems.map((item) => item.id)),
    [filteredAllTableItems],
  );

  const selectedItemsList = useMemo(
    () => items.filter((item) => selectedItemIds.has(item.id)),
    [items, selectedItemIds],
  );

  const effectiveSelectedItems = useMemo(
    () => selectedItemsList.filter((item) => visibleIdSet.has(item.id)),
    [selectedItemsList, visibleIdSet],
  );

  const publishDraftCandidates = useMemo(() => publishableDraftItems(items), [items]);

  const selectionCanPublish = allSelectedPublishable(effectiveSelectedItems);
  const selectionCanUnpublish = allSelectedUnpublishable(effectiveSelectedItems, analytics.bidsByItem);
  const selectionHasRemovable = effectiveSelectedItems.some((item) => item.status !== "removed");

  const allVisibleSelected =
    filteredAllTableItems.length > 0 && filteredAllTableItems.every((item) => selectedItemIds.has(item.id));
  const someVisibleSelected = filteredAllTableItems.some((item) => selectedItemIds.has(item.id));

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (!el) return;
    el.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  const bulkDeleteLockedCount = useMemo(() => {
    return effectiveSelectedItems.filter((item) => {
      if (item.status === "removed") return false;
      const row = analytics.rowsByItemId.get(item.id);
      return isLockedIn(item, row?.topBid);
    }).length;
  }, [analytics.rowsByItemId, effectiveSelectedItems]);

  function toggleItemSelected(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectAllVisibleItems() {
    setSelectedItemIds(new Set(filteredAllTableItems.map((item) => item.id)));
  }

  function clearItemSelection() {
    setMobileFabOpen(false);
    setSelectedItemIds(new Set());
  }

  async function publishItemsDocs(targetItems: AuctionItem[]) {
    const publishable = targetItems.filter(canPublishItem);
    const ops = publishable.map((item) => ({
      ref: doc(db, `auctions/${auctionId}/items/${item.id}`),
      data: {
        status: "open",
        importValidationErrors: deleteField(),
        updatedAt: serverTimestamp(),
      } as UpdateData<DocumentData>,
    }));
    if (!ops.length) return;
    await commitBatchedUpdates(db, ops);
  }

  async function unpublishItemsDocs(targetItems: AuctionItem[]) {
    const bidsByItem = analytics.bidsByItem;
    const ops = targetItems
      .filter((item) => canUnpublishItem(item, (bidsByItem.get(item.id)?.length ?? 0) > 0))
      .map((item) => ({
        ref: doc(db, `auctions/${auctionId}/items/${item.id}`),
        data: { status: "draft", updatedAt: serverTimestamp() } as UpdateData<DocumentData>,
      }));
    if (!ops.length) return;
    await commitBatchedUpdates(db, ops);
  }

  async function removeItemsDocs(targetItems: AuctionItem[]) {
    const ops = targetItems
      .filter((item) => item.status !== "removed")
      .map((item) => ({
        ref: doc(db, `auctions/${auctionId}/items/${item.id}`),
        data: { status: "removed", updatedAt: serverTimestamp() } as UpdateData<DocumentData>,
      }));
    if (!ops.length) return;
    await commitBatchedUpdates(db, ops);
  }

  async function confirmBulkPublish() {
    if (submittingAction) return;
    setSubmittingAction("bulkPublish");
    try {
      const targets = effectiveSelectedItems.filter(canPublishItem);
      await publishItemsDocs(targets);
      toast(`Published ${targets.length} item(s).`);
      clearItemSelection();
      setBulkConfirmModal(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to publish items.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function confirmBulkUnpublish() {
    if (submittingAction) return;
    setSubmittingAction("bulkUnpublish");
    try {
      const bidsByItem = analytics.bidsByItem;
      const targets = effectiveSelectedItems.filter((item) =>
        canUnpublishItem(item, (bidsByItem.get(item.id)?.length ?? 0) > 0),
      );
      await unpublishItemsDocs(effectiveSelectedItems);
      toast(`Unpublished ${targets.length} item(s).`);
      clearItemSelection();
      setBulkConfirmModal(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to unpublish items.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function confirmBulkRemove() {
    if (submittingAction) return;
    setSubmittingAction("bulkRemove");
    try {
      const targets = effectiveSelectedItems.filter((item) => item.status !== "removed");
      await removeItemsDocs(targets);
      toast(`Removed ${targets.length} item(s).`);
      clearItemSelection();
      setBulkConfirmModal(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to remove items.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function confirmPublishAllDrafts() {
    if (submittingAction) return;
    setSubmittingAction("publishAll");
    try {
      await publishItemsDocs(publishDraftCandidates);
      toast(`Published ${publishDraftCandidates.length} draft item(s).`);
      setIsPublishAllModalOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to publish drafts.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function publishSingleItem(item: AuctionItem) {
    if (!canPublishItem(item)) return;
    try {
      await publishItemsDocs([item]);
      toast(`Published ${item.name}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to publish item.");
    }
  }

  async function unpublishSingleItem(item: AuctionItem) {
    const hasBids = (analytics.bidsByItem.get(item.id)?.length ?? 0) > 0;
    if (!canUnpublishItem(item, hasBids)) return;
    try {
      await unpublishItemsDocs([item]);
      toast(`Unpublished ${item.name}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to unpublish item.");
    }
  }

  if (!user) return null;

  return (
    <div
      className={`min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-8 ${activeTab === "all" ? "pb-28 md:pb-6" : ""}`}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Admin Dashboard</p>
          <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-bold">{auction?.title ?? "Auction"}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-slate-300">
                <span>Auction ID: {auctionId}</span>
                <button
                  className="inline-flex rounded-full p-1 text-slate-300 transition hover:bg-white/10 hover:text-white"
                  type="button"
                  onClick={copyGuestLoginLink}
                  aria-label="Copy guest login link"
                  title="Copy guest login link"
                >
                  <Copy size={14} />
                </button>
                <span aria-hidden="true">·</span>
                <span>Status: {auction?.status ?? "loading"}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {auction?.status === "pending" ? (
                <button className="button-light" onClick={() => setIsOpenModalOpen(true)}>
                  Open
                </button>
              ) : auction?.status === "closed" ? (
                <button className="button-light" onClick={() => setIsReopenModalOpen(true)}>
                  Re-open
                </button>
              ) : auction?.status === "open" ? (
                <button
                  className="rounded-full bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700"
                  onClick={() => setIsSettleModalOpen(true)}
                >
                  Close out
                </button>
              ) : null}
              <Link
                className="button-light inline-flex"
                href={`/auctions/${auctionId}/admin/settings`}
                aria-label="Auction settings"
              >
                <Settings size={18} />
              </Link>
              <button className="button-light" onClick={logout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4">
          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Revenue" value={formatCurrency(analytics.revenue)} />
            <Stat label="Total bids" value={String(analytics.totalBids)} />
            <Stat label="Items with bid" value={String(analytics.itemsWithBids)} />
            <Stat label="Locked-in bids" value={String(analytics.lockedInBids)} />
          </section>

          {auction?.status === "closed" ? (
            <section className="card overflow-hidden">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Settlement
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">Winning Summary &amp; Dues</h2>
                </div>
                <div className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-950">{settlement.totalItems}</span> item(s) ·{" "}
                  <span className="font-semibold text-slate-950">
                    {formatCurrency(settlement.totalRevenue)}
                  </span>{" "}
                  total owed
                </div>
              </div>

              {settlement.winners.length ? (
                <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {settlement.winners.map((winner) => {
                    const isExpanded = expandedWinnerUids.has(winner.uid);
                    return (
                      <div className="h-fit rounded-2xl border border-slate-100 bg-white" key={winner.uid}>
                        <button
                          className="flex w-full items-center justify-between gap-3 p-4 text-left"
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleWinnerExpanded(winner.uid)}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950">
                              {winner.displayName}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">{winner.items.length} item(s)</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <p className="text-sm font-semibold text-slate-950">
                              {formatCurrency(winner.totalOwed)}
                            </p>
                            {isExpanded ? (
                              <ChevronDown aria-hidden="true" className="text-slate-500" size={18} />
                            ) : (
                              <ChevronRight aria-hidden="true" className="text-slate-500" size={18} />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                            <div className="space-y-2">
                              {winner.items.map(({ item, owed }) => (
                                <div
                                  className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-xl bg-slate-50 p-3"
                                  key={item.id}
                                >
                                  <p className="min-w-0 wrap-break-word text-sm font-medium text-slate-950">
                                    {item.name}
                                  </p>
                                  <p className="whitespace-nowrap text-right text-sm font-semibold text-green-700">
                                    {formatCurrency(owed)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  No items have been settled or locked in yet.
                </p>
              )}
            </section>
          ) : (
            <div />
          )}
        </section>

        <section className="space-y-4">
          <div className="sticky top-0 z-20 -mx-4 space-y-3 bg-slate-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="order-2 flex min-w-max rounded-full bg-white p-1 shadow-sm sm:order-1">
                <button
                  className={`tab whitespace-nowrap ${activeTab === "current" ? "tab-active" : ""}`}
                  onClick={() => setActiveTab("current")}
                >
                  Current bids
                </button>
                <button
                  className={`tab whitespace-nowrap ${activeTab === "all" ? "tab-active" : ""}`}
                  onClick={() => setActiveTab("all")}
                >
                  All items
                </button>
              </div>
              {activeTab === "all" && (
                <div className="order-1 hidden flex-wrap items-center justify-end gap-2 sm:order-2 md:flex">
                  <button
                    className="button-secondary whitespace-nowrap px-3 py-2 text-sm"
                    disabled={publishDraftCandidates.length === 0}
                    type="button"
                    onClick={() => setIsPublishAllModalOpen(true)}
                  >
                    Publish all drafts
                  </button>
                  {effectiveSelectedItems.length >= 1 && (
                    <>
                      {selectionCanPublish && (
                        <button
                          className="icon-button rounded-full bg-white shadow-sm"
                          aria-label="Publish selected items"
                          title="Publish selected"
                          type="button"
                          onClick={() => setBulkConfirmModal("publish")}
                        >
                          <Upload size={18} />
                        </button>
                      )}
                      {selectionCanUnpublish && (
                        <button
                          className="icon-button rounded-full bg-white shadow-sm"
                          aria-label="Unpublish selected items"
                          title="Unpublish selected"
                          type="button"
                          onClick={() => setBulkConfirmModal("unpublish")}
                        >
                          <Undo2 size={18} />
                        </button>
                      )}
                      {selectionHasRemovable && (
                        <button
                          className="icon-button rounded-full bg-white text-red-700 shadow-sm hover:bg-red-50"
                          aria-label="Remove selected items"
                          title="Remove selected"
                          type="button"
                          onClick={() => setBulkConfirmModal("delete")}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="icon-button rounded-full bg-slate-950 text-white shadow-sm hover:bg-slate-800"
                    aria-label="Add item"
                    title="Add item"
                    type="button"
                    onClick={openNewItemModal}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <input
                aria-label={activeTab === "current" ? "Search current bids" : "Search all items"}
                className="input pr-12"
                enterKeyHint="done"
                placeholder={
                  activeTab === "current"
                    ? "Search bids by item, notes, keywords, or bidder"
                    : "Search items by name, notes, or keywords"
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

          {activeTab === "current" ? (
            <section className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-3">Item</th>
                      <th>1st Bid</th>
                      <th>2nd Bid</th>
                      <th>Locked In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCurrentRows.map((row) => {
                      const lockedIn = isLockedIn(row.item, row.topBid);

                      return (
                        <tr className="border-t border-slate-100" key={row.item.id}>
                          <td className="py-3 font-medium">{row.item.name}</td>
                          <td>{lockedIn ? "-" : formatBid(row.topBid)}</td>
                          <td>{lockedIn ? "-" : formatSecondBid(row.item, row.secondBid)}</td>
                          <td>{formatLockedInBid(row.item, row.topBid)}</td>
                        </tr>
                      );
                    })}
                    {!filteredCurrentRows.length && (
                      <tr className="border-t border-slate-100">
                        <td className="py-6 text-center text-slate-500" colSpan={4}>
                          {trimmedSearchQuery ? "No current bids match your search." : "No current bids yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="card space-y-4 overflow-hidden">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <input
                      id="show-invalid-items"
                      type="checkbox"
                      checked={showInvalidItems}
                      onChange={(event) => setShowInvalidItems(event.target.checked)}
                    />
                    <label htmlFor="show-invalid-items">Show invalid</label>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <input
                      id="show-removed-items"
                      type="checkbox"
                      checked={showRemovedItems}
                      onChange={(event) => setShowRemovedItems(event.target.checked)}
                    />
                    <label htmlFor="show-removed-items">Show removed</label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-slate-600">
                  <span>Total item count: {analytics.totalItems}</span>
                  <span>Invalid item count: {analytics.invalidItems}</span>
                </div>
              </div>
              <div className="flex md:hidden">
                <button
                  className="button-secondary text-sm"
                  disabled={publishDraftCandidates.length === 0}
                  type="button"
                  onClick={() => setIsPublishAllModalOpen(true)}
                >
                  Publish all drafts
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="w-10 py-3 pr-2">
                        <input
                          ref={selectAllCheckboxRef}
                          aria-label="Select all visible items"
                          checked={allVisibleSelected}
                          type="checkbox"
                          onChange={(event) => {
                            if (event.target.checked) selectAllVisibleItems();
                            else clearItemSelection();
                          }}
                        />
                      </th>
                      <th className="py-3">Item</th>
                      <th>Item notes</th>
                      <th>MSRP</th>
                      <th>Start price</th>
                      <th>Lock-in price</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAllTableItems.map((item) => (
                      <tr
                        className={`border-t border-slate-100 ${item.status === "invalid" ? "bg-yellow-50" : ""}`}
                        key={item.id}
                      >
                        <td className="pr-2 align-middle">
                          <input
                            aria-label={`Select ${item.name}`}
                            checked={selectedItemIds.has(item.id)}
                            type="checkbox"
                            onChange={() => toggleItemSelected(item.id)}
                          />
                        </td>
                        <td className="py-3 font-medium">{item.name}</td>
                        <td className="max-w-xs text-slate-600">
                          <p>{item.notes || "-"}</p>
                          {item.keywords && (
                            <p className="mt-1 text-xs font-semibold text-slate-400">
                              Keywords: {item.keywords}
                            </p>
                          )}
                        </td>
                        <td>{formatCurrency(item.msrp)}</td>
                        <td>{formatCurrency(item.startingPrice)}</td>
                        <td>{formatCurrency(item.lockInPrice)}</td>
                        <td>{item.status}</td>
                        <td className="whitespace-nowrap">
                          {canPublishItem(item) && (
                            <button
                              className="icon-button"
                              aria-label={`Publish ${item.name}`}
                              title="Publish"
                              type="button"
                              onClick={() => void publishSingleItem(item)}
                            >
                              <Upload size={16} />
                            </button>
                          )}
                          {canUnpublishItem(item, (analytics.bidsByItem.get(item.id)?.length ?? 0) > 0) && (
                            <button
                              className="icon-button"
                              aria-label={`Unpublish ${item.name}`}
                              title="Unpublish"
                              type="button"
                              onClick={() => void unpublishSingleItem(item)}
                            >
                              <Undo2 size={16} />
                            </button>
                          )}
                          <button
                            className="icon-button"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => openEditItemModal(item)}
                          >
                            <Pencil size={16} />
                          </button>
                          {item.status !== "removed" && (
                            <button
                              className="icon-button"
                              aria-label={`Remove ${item.name}`}
                              onClick={() => removeItem(item)}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          {item.status === "removed" && (
                            <button
                              className="icon-button"
                              aria-label={`Restore ${item.name}`}
                              onClick={() => restoreItem(item)}
                            >
                              <RotateCcw size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!filteredAllTableItems.length && (
                      <tr className="border-t border-slate-100">
                        <td className="py-6 text-center text-slate-500" colSpan={8}>
                          {trimmedSearchQuery ? "No items match your search." : "No items to show."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      </div>

      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.form
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            onSubmit={saveItem}
          >
            <h2 className="text-2xl font-bold">{editingItem ? "Edit item" : "Add item"}</h2>
            <div className="mt-5 space-y-3">
              <label className="label">
                Item Name
                <input
                  className="input mt-1"
                  value={itemForm.name}
                  onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                  required
                />
              </label>
              <label className="label">
                Notes
                <textarea
                  className="input mt-1 min-h-24"
                  value={itemForm.notes}
                  onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })}
                />
              </label>
              <label className="label">
                Keywords
                <input
                  className="input mt-1"
                  placeholder="Hidden from guests; used for search"
                  value={itemForm.keywords}
                  onChange={(event) => setItemForm({ ...itemForm, keywords: event.target.value })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberInput
                  label="MSRP"
                  value={itemForm.msrp}
                  onChange={(msrp) => setItemForm({ ...itemForm, msrp })}
                />
                <NumberInput
                  label="Starting price"
                  value={itemForm.startingPrice}
                  onChange={(startingPrice) => setItemForm({ ...itemForm, startingPrice })}
                  required
                />
                <NumberInput
                  label="Lock-in price"
                  value={itemForm.lockInPrice}
                  onChange={(lockInPrice) => setItemForm({ ...itemForm, lockInPrice })}
                  required
                />
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={submittingAction === "item"}
                submittingLabel={editingItem ? "Saving..." : "Adding..."}
                type="submit"
              >
                {editingItem ? "Save item" : "Add item"}
              </SubmittingButton>
              <button
                className="button-ghost"
                disabled={submittingAction === "item"}
                type="button"
                onClick={closeItemModal}
              >
                Cancel
              </button>
            </div>
          </motion.form>
        </div>
      )}

      {isOpenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-bold">Open auction?</h2>
            <p className="mt-3 text-slate-600">
              This will let guests place, edit, and lock in bids. Guests can browse <strong>published</strong>{" "}
              items while the auction is pending; draft items stay admin-only until you publish them.
            </p>
            <p className="mt-3 font-semibold text-slate-950">Are you sure?</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={submittingAction === "open"}
                submittingLabel="Opening..."
                onClick={openAuction}
              >
                Yes, open auction
              </SubmittingButton>
              <button
                className="button-ghost flex-1"
                disabled={submittingAction === "open"}
                type="button"
                onClick={() => setIsOpenModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isSettleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-bold">Close and settle auction?</h2>
            <p className="mt-3 text-slate-600">
              This will close the auction and no more bids can be made. Winners and final prices will be
              settled from the current bids.
            </p>
            <p className="mt-3 font-semibold text-slate-950">Are you sure?</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={submittingAction === "settle"}
                submittingLabel="Closing..."
                onClick={settleAuction}
              >
                Yes
              </SubmittingButton>
              <button
                className="button-ghost flex-1"
                disabled={submittingAction === "settle"}
                type="button"
                onClick={() => setIsSettleModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isReopenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-bold">Re-open auction?</h2>
            <p className="mt-3 text-slate-600">
              This will let guests place and edit regular bids again. Settled items will return to open
              status, while locked-in items will stay locked.
            </p>
            <p className="mt-3 font-semibold text-slate-950">Are you sure?</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={submittingAction === "reopen"}
                submittingLabel="Re-opening..."
                onClick={reopenAuction}
              >
                Yes, re-open
              </SubmittingButton>
              <button
                className="button-ghost flex-1"
                disabled={submittingAction === "reopen"}
                type="button"
                onClick={() => setIsReopenModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {activeTab === "all" && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-30 md:hidden">
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {mobileFabOpen && effectiveSelectedItems.length >= 1 && (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex min-w-[11rem] flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                initial={{ opacity: 0, y: 12 }}
              >
                {selectionCanPublish && (
                  <button
                    className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-slate-950 hover:bg-slate-50"
                    type="button"
                    onClick={() => {
                      setMobileFabOpen(false);
                      setBulkConfirmModal("publish");
                    }}
                  >
                    Publish
                  </button>
                )}
                {selectionCanUnpublish && (
                  <button
                    className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-slate-950 hover:bg-slate-50"
                    type="button"
                    onClick={() => {
                      setMobileFabOpen(false);
                      setBulkConfirmModal("unpublish");
                    }}
                  >
                    Unpublish
                  </button>
                )}
                {selectionHasRemovable && (
                  <button
                    className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                    type="button"
                    onClick={() => {
                      setMobileFabOpen(false);
                      setBulkConfirmModal("delete");
                    }}
                  >
                    Delete
                  </button>
                )}
              </motion.div>
            )}
            <button
              aria-label={effectiveSelectedItems.length >= 1 ? "Item actions" : "Add item"}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg transition hover:bg-slate-800"
              type="button"
              onClick={() => {
                if (effectiveSelectedItems.length === 0) openNewItemModal();
                else setMobileFabOpen((open) => !open);
              }}
            >
              {effectiveSelectedItems.length >= 1 ? <Menu size={24} /> : <Plus size={24} />}
            </button>
          </div>
        </div>
      )}

      {isPublishAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            initial={{ opacity: 0, y: 24 }}
          >
            <h2 className="text-2xl font-bold">Publish all drafts?</h2>
            <p className="mt-3 text-slate-600">
              This will publish <strong>{publishDraftCandidates.length}</strong> valid draft item(s). Guests
              will be able to see published items in the auction catalog.
            </p>
            <p className="mt-3 font-semibold text-slate-950">Are you sure?</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                disabled={publishDraftCandidates.length === 0}
                isSubmitting={submittingAction === "publishAll"}
                submittingLabel="Publishing..."
                onClick={confirmPublishAllDrafts}
              >
                Yes, publish all
              </SubmittingButton>
              <button
                className="button-ghost flex-1"
                disabled={submittingAction === "publishAll"}
                type="button"
                onClick={() => setIsPublishAllModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {bulkConfirmModal === "publish" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            initial={{ opacity: 0, y: 24 }}
          >
            <h2 className="text-2xl font-bold">Publish selected items?</h2>
            <p className="mt-3 text-slate-600">
              <strong>{effectiveSelectedItems.filter(canPublishItem).length}</strong> draft item(s) will
              become live for guests (status: open).
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={submittingAction === "bulkPublish"}
                submittingLabel="Publishing..."
                onClick={confirmBulkPublish}
              >
                Publish
              </SubmittingButton>
              <button
                className="button-ghost flex-1"
                disabled={submittingAction === "bulkPublish"}
                type="button"
                onClick={() => setBulkConfirmModal(null)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {bulkConfirmModal === "unpublish" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            initial={{ opacity: 0, y: 24 }}
          >
            <h2 className="text-2xl font-bold">Unpublish selected items?</h2>
            <p className="mt-3 text-slate-600">
              <strong>
                {
                  effectiveSelectedItems.filter((item) =>
                    canUnpublishItem(item, (analytics.bidsByItem.get(item.id)?.length ?? 0) > 0),
                  ).length
                }
              </strong>{" "}
              item(s) with no bids will return to draft and will be hidden from guests.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="button flex-1"
                isSubmitting={submittingAction === "bulkUnpublish"}
                submittingLabel="Unpublishing..."
                onClick={confirmBulkUnpublish}
              >
                Unpublish
              </SubmittingButton>
              <button
                className="button-ghost flex-1"
                disabled={submittingAction === "bulkUnpublish"}
                type="button"
                onClick={() => setBulkConfirmModal(null)}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {bulkConfirmModal === "delete" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
            initial={{ opacity: 0, y: 24 }}
          >
            <h2 className="text-2xl font-bold">Remove selected items?</h2>
            <p className="mt-3 text-slate-600">
              <strong>{effectiveSelectedItems.filter((item) => item.status !== "removed").length}</strong>{" "}
              item(s) will be marked removed.
              {bulkDeleteLockedCount > 0 ? (
                <>
                  {" "}
                  <strong>{bulkDeleteLockedCount}</strong> are locked in with bids—guest bidding may still be
                  affected until you resolve those items.
                </>
              ) : null}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmittingButton
                className="flex-1 rounded-full bg-red-600 px-5 py-3 font-bold text-white transition hover:bg-red-700"
                isSubmitting={submittingAction === "bulkRemove"}
                submittingLabel="Removing..."
                onClick={confirmBulkRemove}
              >
                Remove
              </SubmittingButton>
              <button
                className="button-secondary flex-1"
                disabled={submittingAction === "bulkRemove"}
                type="button"
                onClick={() => setBulkConfirmModal(null)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-sm sm:font-normal sm:tracking-normal">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold sm:mt-2 sm:text-3xl">{value}</p>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="label">
      {label}
      <input
        className="input mt-1"
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

function formatBid(bid?: Bid) {
  return bid ? `${formatCurrency(bid.amount)} by ${bid.bidderName}` : "-";
}

function formatSecondBid(item: AuctionItem, secondBid?: Bid) {
  return secondBid ? formatBid(secondBid) : `Start at ${formatCurrency(item.startingPrice)}`;
}

function formatLockedInBid(item: AuctionItem, topBid?: Bid) {
  if (!isLockedIn(item, topBid)) return "-";

  const lockedAmount =
    item.winningBid ?? item.finalPrice ?? (topBid?.type === "locked" ? topBid.amount : undefined);
  const lockedBy = item.winnerName ?? (topBid?.type === "locked" ? topBid.bidderName : undefined);
  if (lockedAmount === undefined || !lockedBy) return "-";

  return `${formatCurrency(lockedAmount)} by ${lockedBy}`;
}

function isLockedIn(item: AuctionItem, topBid?: Bid) {
  return item.status === "locked" || topBid?.type === "locked";
}

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { calculateVickreyBreakdown, formatCurrency, normalizeItemName } from "@/lib/auction/calculations";
import type { Auction, AuctionItem, Bid } from "@/lib/auction/types";
import { auth, db } from "@/lib/firebase/client";

type Props = {
  auctionId: string;
};

const emptyItemForm = {
  name: "",
  notes: "",
  msrp: "",
  startingPrice: "0",
  lockInPrice: "0",
};

type ItemForm = typeof emptyItemForm;
type AdminTab = "current" | "all";

export function AdminDashboard({ auctionId }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [activeTab, setActiveTab] = useState<AdminTab>("current");
  const [showRemovedItems, setShowRemovedItems] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [editingItem, setEditingItem] = useState<AuctionItem | null>(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
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
  }, [auctionId]);

  const analytics = useMemo(() => {
    const bidsByItem = new Map<string, Bid[]>();
    bids.forEach((bid) => bidsByItem.set(bid.itemId, [...(bidsByItem.get(bid.itemId) ?? []), bid]));
    const activeItems = items.filter((item) => item.status !== "removed");
    const rows = activeItems.map((item) => calculateVickreyBreakdown(item, bidsByItem.get(item.id) ?? []));
    const rowsByItemId = new Map(rows.map((row) => [row.item.id, row]));
    return {
      rows,
      rowsByItemId,
      activeItems,
      currentRows: rows.filter((row) => row.topBid),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      totalBids: bids.length,
    };
  }, [bids, items]);

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    const payload = {
      name: itemForm.name.trim(),
      notes: itemForm.notes.trim(),
      msrp: Number(itemForm.msrp || 0),
      startingPrice: Number(itemForm.startingPrice),
      lockInPrice: Number(itemForm.lockInPrice),
      normalizedName: normalizeItemName(itemForm.name),
      updatedAt: serverTimestamp(),
    };

    if (editingItem) {
      await updateDoc(doc(db, `auctions/${auctionId}/items/${editingItem.id}`), payload);
    } else {
      const itemRef = doc(collection(db, `auctions/${auctionId}/items`));
      await setDoc(itemRef, {
        ...payload,
        status: "open",
        createdAt: serverTimestamp(),
      });
    }

    closeItemModal();
  }

  async function settleAuction() {
    const token = await user?.getIdToken();
    if (!token) return setMessage("Sign in as an auction admin first.");
    const response = await fetch(`/api/auctions/${auctionId}/settle`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    setMessage(response.ok ? "Auction settled." : result.error);
    if (response.ok) setIsSettleModalOpen(false);
  }

  function openNewItemModal() {
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setIsItemModalOpen(true);
  }

  function openEditItemModal(item: AuctionItem) {
    setEditingItem(item);
    setItemForm({
      name: item.name,
      notes: item.notes ?? "",
      msrp: item.msrp ? String(item.msrp) : "",
      startingPrice: String(item.startingPrice ?? 0),
      lockInPrice: String(item.lockInPrice ?? 0),
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

  const allTableItems = showRemovedItems ? items : analytics.activeItems;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Admin Dashboard</p>
          <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-bold">{auction?.title ?? "Auction"}</h1>
              <p className="mt-1 text-sm text-slate-300">Auction ID: {auctionId}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="button-light inline-flex"
                href={`/auctions/${auctionId}/admin/settings`}
                aria-label="Auction settings"
              >
                <Settings size={18} />
              </Link>
              <button
                className="rounded-full bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700"
                onClick={() => setIsSettleModalOpen(true)}
              >
                Close auction
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="Real-time revenue" value={formatCurrency(analytics.revenue)} />
          <Stat label="Total bids" value={String(analytics.totalBids)} />
          <Stat label="Items" value={String(analytics.activeItems.length)} />
        </section>

        {message && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}

        <section className="space-y-4">
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
            <button className="button order-1 inline-flex gap-2 sm:order-2" onClick={openNewItemModal}>
              <Plus size={18} />
              Add item
            </button>
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
                    {analytics.currentRows.map((row) => (
                      <tr className="border-t border-slate-100" key={row.item.id}>
                        <td className="py-3 font-medium">{row.item.name}</td>
                        <td>{formatBid(row.topBid)}</td>
                        <td>{formatBid(row.secondBid)}</td>
                        <td>{isLockedIn(row.item, row.topBid) ? "Lock In" : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="card space-y-4 overflow-hidden">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={showRemovedItems}
                  onChange={(event) => setShowRemovedItems(event.target.checked)}
                />
                Show removed items
              </label>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-3">Item</th>
                      <th>Item notes</th>
                      <th>MSRP</th>
                      <th>Start price</th>
                      <th>Lock-in price</th>
                      {showRemovedItems && <th>Status</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {allTableItems.map((item) => (
                      <tr className="border-t border-slate-100" key={item.id}>
                        <td className="py-3 font-medium">{item.name}</td>
                        <td className="max-w-xs text-slate-600">{item.notes || "-"}</td>
                        <td>{formatCurrency(item.msrp)}</td>
                        <td>{formatCurrency(item.startingPrice)}</td>
                        <td>{formatCurrency(item.lockInPrice)}</td>
                        {showRemovedItems && <td>{item.status}</td>}
                        <td>
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
                        </td>
                      </tr>
                    ))}
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
              <button className="button flex-1" type="submit">
                {editingItem ? "Save item" : "Add item"}
              </button>
              <button className="button-ghost" type="button" onClick={closeItemModal}>
                Cancel
              </button>
            </div>
          </motion.form>
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
              <button className="button flex-1" onClick={settleAuction}>
                Yes
              </button>
              <button className="button-ghost" type="button" onClick={() => setIsSettleModalOpen(false)}>
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
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
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

function isLockedIn(item: AuctionItem, topBid?: Bid) {
  return item.status === "locked" || topBid?.type === "locked";
}

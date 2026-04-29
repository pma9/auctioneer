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
import { Pencil, Plus, Sheet, Trash2 } from "lucide-react";
import { calculateVickreyBreakdown, formatCurrency, normalizeItemName } from "@/lib/auction/calculations";
import { US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import type { Auction, AuctionItem, Bid } from "@/lib/auction/types";
import { auth, db } from "@/lib/firebase/client";

type Props = {
  auctionId: string;
};

const emptyItem = {
  name: "",
  notes: "",
  msrp: 0,
  startingPrice: 0,
  lockInPrice: 0,
};

export function AdminDashboard({ auctionId }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [itemForm, setItemForm] = useState(emptyItem);
  const [guestForm, setGuestForm] = useState({ displayName: "", phone: "" });
  const [message, setMessage] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const unsubAuction = onSnapshot(doc(db, `auctions/${auctionId}`), (snapshot) =>
      setAuction(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Auction) : null),
    );
    const unsubItems = onSnapshot(collection(db, `auctions/${auctionId}/items`), (snapshot) =>
      setItems(
        snapshot.docs
          .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }) as AuctionItem)
          .filter((item) => item.status !== "removed"),
      ),
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
    const rows = items.map((item) => calculateVickreyBreakdown(item, bidsByItem.get(item.id) ?? []));
    return {
      rows,
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      totalBids: bids.length,
    };
  }, [bids, items]);

  async function importSheet(event: FormEvent) {
    event.preventDefault();
    const token = await user?.getIdToken();
    if (!token) return setMessage("Sign in as an auction admin first.");
    const response = await fetch(`/api/auctions/${auctionId}/import-sheet`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sheetUrlOrId: sheetUrl }),
    });
    const result = await response.json();
    setMessage(
      response.ok
        ? `Imported ${result.total} rows: ${result.created} new, ${result.updated} updated.`
        : result.error,
    );
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    const itemRef = doc(collection(db, `auctions/${auctionId}/items`));
    await setDoc(itemRef, {
      ...itemForm,
      normalizedName: normalizeItemName(itemForm.name),
      status: "open",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setItemForm(emptyItem);
  }

  async function addGuest(event: FormEvent) {
    event.preventDefault();
    const token = await user?.getIdToken();
    if (!token) return setMessage("Sign in as an auction admin first.");
    const response = await fetch(`/api/auctions/${auctionId}/guests`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(guestForm),
    });
    const result = await response.json();
    setMessage(response.ok ? "Guest added to the private allowlist." : result.error);
    if (response.ok) setGuestForm({ displayName: "", phone: "" });
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
  }

  async function editItem(item: AuctionItem) {
    const name = window.prompt("Item name", item.name);
    if (!name) return;
    const msrp = Number(window.prompt("MSRP", String(item.msrp)) ?? item.msrp);
    const startingPrice = Number(
      window.prompt("Starting price", String(item.startingPrice)) ?? item.startingPrice,
    );
    const lockInPrice = Number(window.prompt("Lock-in price", String(item.lockInPrice)) ?? item.lockInPrice);
    const notes = window.prompt("Notes", item.notes) ?? item.notes;

    await updateDoc(doc(db, `auctions/${auctionId}/items/${item.id}`), {
      name,
      normalizedName: normalizeItemName(name),
      notes,
      msrp,
      startingPrice,
      lockInPrice,
      updatedAt: serverTimestamp(),
    });
  }

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
            <button className="button-light" onClick={settleAuction}>
              Close and settle Vickrey winners
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="Real-time revenue" value={formatCurrency(analytics.revenue)} />
          <Stat label="Total bids" value={String(analytics.totalBids)} />
          <Stat label="Items" value={String(items.length)} />
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <motion.form layout className="card space-y-4" onSubmit={importSheet}>
            <div className="flex items-center gap-2">
              <Sheet size={18} />
              <h2 className="font-semibold">Sheet import</h2>
            </div>
            <input
              className="input"
              placeholder="Google Sheet URL or ID"
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
            />
            <button className="button w-full" type="submit">
              Import catalog
            </button>
          </motion.form>

          <motion.form layout className="card space-y-3" onSubmit={saveItem}>
            <div className="flex items-center gap-2">
              <Plus size={18} />
              <h2 className="font-semibold">Add item</h2>
            </div>
            <input
              className="input"
              placeholder="Name"
              value={itemForm.name}
              onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
            />
            <input
              className="input"
              placeholder="Notes"
              value={itemForm.notes}
              onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })}
            />
            <div className="grid grid-cols-3 gap-2">
              <NumberInput
                label="MSRP"
                value={itemForm.msrp}
                onChange={(msrp) => setItemForm({ ...itemForm, msrp })}
              />
              <NumberInput
                label="Start"
                value={itemForm.startingPrice}
                onChange={(startingPrice) => setItemForm({ ...itemForm, startingPrice })}
              />
              <NumberInput
                label="Lock"
                value={itemForm.lockInPrice}
                onChange={(lockInPrice) => setItemForm({ ...itemForm, lockInPrice })}
              />
            </div>
            <button className="button w-full" type="submit">
              Add item
            </button>
          </motion.form>

          <motion.form layout className="card space-y-3" onSubmit={addGuest}>
            <h2 className="font-semibold">Verified guest</h2>
            <input
              className="input"
              placeholder="Guest name"
              value={guestForm.displayName}
              onChange={(event) => setGuestForm({ ...guestForm, displayName: event.target.value })}
            />
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={US_PHONE_PLACEHOLDER}
              value={guestForm.phone}
              onChange={(event) => setGuestForm({ ...guestForm, phone: event.target.value })}
            />
            <button className="button w-full" type="submit">
              Add private guest
            </button>
          </motion.form>
        </section>

        {message && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}

        <section className="card overflow-hidden">
          <h2 className="mb-4 text-xl font-semibold">Item-by-item breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-3">Item</th>
                  <th>MSRP</th>
                  <th>Start</th>
                  <th>Lock-in</th>
                  <th>1st bid</th>
                  <th>2nd bid</th>
                  <th>Revenue</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {analytics.rows.map((row) => (
                  <tr className="border-t border-slate-100" key={row.item.id}>
                    <td className="py-3 font-medium">{row.item.name}</td>
                    <td>{formatCurrency(row.item.msrp)}</td>
                    <td>{formatCurrency(row.item.startingPrice)}</td>
                    <td>{formatCurrency(row.item.lockInPrice)}</td>
                    <td>
                      {row.topBid ? `${formatCurrency(row.topBid.amount)} by ${row.topBid.bidderName}` : "-"}
                    </td>
                    <td>
                      {row.secondBid
                        ? `${formatCurrency(row.secondBid.amount)} by ${row.secondBid.bidderName}`
                        : "-"}
                    </td>
                    <td>{formatCurrency(row.revenue)}</td>
                    <td>{row.item.status}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${row.item.name}`}
                        onClick={() => editItem(row.item)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${row.item.name}`}
                        onClick={() =>
                          updateDoc(doc(db, `auctions/${auctionId}/items/${row.item.id}`), {
                            status: "removed",
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      className="input"
      aria-label={label}
      placeholder={label}
      type="number"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

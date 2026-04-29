"use client";

import { FormEvent, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { ArrowLeft, Pencil, Sheet, Trash2, UserPlus } from "lucide-react";
import { US_PHONE_PLACEHOLDER } from "@/lib/auction/phone-normalization";
import type { Auction, VerifiedGuest } from "@/lib/auction/types";
import { db } from "@/lib/firebase/client";
import { useRequiredFirebaseUser } from "@/components/useRequiredFirebaseUser";

type Props = {
  auctionId: string;
};

type GuestRow = VerifiedGuest & {
  id: string;
};

type ImportSheetResponse = {
  created: number;
  updated: number;
  total: number;
  skipped?: number;
  skippedRows?: { sourceRow: number; reason: string }[];
  error?: string;
};

const emptyGuestForm = {
  displayName: "",
  phone: "",
};

const emptyNotesForm = {
  auctionNotes: "",
  closingNotes: "",
};

export function AdminAuctionSettings({ auctionId }: Props) {
  const user = useRequiredFirebaseUser();
  const [auction, setAuction] = useState<Auction | null>(null);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [notesForm, setNotesForm] = useState(emptyNotesForm);
  const [guestForm, setGuestForm] = useState(emptyGuestForm);
  const [editingGuest, setEditingGuest] = useState<GuestRow | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;

    const unsubAuction = onSnapshot(doc(db, `auctions/${auctionId}`), (snapshot) => {
      const nextAuction = snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Auction) : null;
      setAuction(nextAuction);
      setNotesForm({
        auctionNotes: nextAuction?.auctionNotes ?? "",
        closingNotes: nextAuction?.closingNotes ?? "",
      });
    });
    const unsubGuests = onSnapshot(collection(db, `auctions/${auctionId}/verifiedGuests`), (snapshot) =>
      setGuests(
        snapshot.docs.map((guestDoc) => {
          const data = guestDoc.data() as VerifiedGuest;
          return { ...data, id: guestDoc.id, phoneHash: data.phoneHash ?? guestDoc.id };
        }),
      ),
    );

    return () => {
      unsubAuction();
      unsubGuests();
    };
  }, [auctionId, user]);

  async function importSheet(event: FormEvent) {
    event.preventDefault();
    const token = await user?.getIdToken();
    if (!token) return setMessage("Sign in as an auction admin first.");
    const response = await fetch(`/api/auctions/${auctionId}/import-sheet`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sheetUrlOrId: sheetUrl }),
    });
    const result = (await response.json()) as ImportSheetResponse;
    if (!response.ok) return setMessage(result.error ?? "Unable to import sheet.");

    const skippedPreview = result.skippedRows
      ?.slice(0, 5)
      .map((row) => `row ${row.sourceRow}: ${row.reason}`)
      .join("; ");
    const skippedMessage = result.skipped
      ? ` Skipped ${result.skipped} rows. ${skippedPreview ? `Reasons: ${skippedPreview}.` : ""}`
      : "";
    setMessage(
      `Imported ${result.total} rows: ${result.created} new, ${result.updated} updated.${skippedMessage}`,
    );
  }

  async function saveAuctionNotes(event: FormEvent) {
    event.preventDefault();
    await updateDoc(doc(db, `auctions/${auctionId}`), {
      auctionNotes: notesForm.auctionNotes.trim(),
      closingNotes: notesForm.closingNotes.trim(),
      updatedAt: serverTimestamp(),
    });
    setMessage("Auction notes saved.");
  }

  async function saveGuest(event: FormEvent) {
    event.preventDefault();
    const token = await user?.getIdToken();
    if (!token) return setMessage("Sign in as an auction admin first.");

    const response = await fetch(`/api/auctions/${auctionId}/guests`, {
      method: editingGuest ? "PATCH" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        phoneHash: editingGuest?.phoneHash,
        displayName: guestForm.displayName,
        phone: guestForm.phone,
      }),
    });
    const result = await response.json();
    setMessage(response.ok ? (editingGuest ? "Guest updated." : "Guest added.") : result.error);
    if (response.ok) resetGuestForm();
  }

  async function removeGuest(guest: GuestRow) {
    const confirmed = window.confirm(`Remove ${guest.displayName} from the guest list?`);
    if (!confirmed) return;

    const token = await user?.getIdToken();
    if (!token) return setMessage("Sign in as an auction admin first.");
    const response = await fetch(`/api/auctions/${auctionId}/guests`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ phoneHash: guest.phoneHash }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Guest removed." : result.error);
  }

  function editGuest(guest: GuestRow) {
    setEditingGuest(guest);
    setGuestForm({
      displayName: guest.displayName,
      phone: guest.normalizedPhone ?? "",
    });
  }

  function resetGuestForm() {
    setEditingGuest(null);
    setGuestForm(emptyGuestForm);
  }

  if (!user) return null;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300"
            href={`/auctions/${auctionId}/admin`}
          >
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
          <p className="mt-6 text-sm uppercase tracking-[0.2em] text-amber-300 sm:tracking-[0.3em]">
            Auction Settings
          </p>
          <h1 className="mt-3 wrap-break-word text-3xl font-bold">{auction?.title ?? "Auction"}</h1>
          <p className="mt-1 text-sm text-slate-300">Auction ID: {auctionId}</p>
        </header>

        {message && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}

        <motion.form layout className="card space-y-4" onSubmit={saveAuctionNotes}>
          <div>
            <h2 className="font-semibold">Guest dashboard notes</h2>
            <p className="mt-1 text-sm text-slate-600">
              Share general auction information while bidding is open, then payment or pickup instructions
              after close.
            </p>
          </div>
          <label className="label">
            Auction notes
            <textarea
              className="input mt-1 min-h-24"
              value={notesForm.auctionNotes}
              onChange={(event) => setNotesForm({ ...notesForm, auctionNotes: event.target.value })}
              placeholder="Shown to guests while the auction is open."
            />
          </label>
          <label className="label">
            Closing notes
            <textarea
              className="input mt-1 min-h-24"
              value={notesForm.closingNotes}
              onChange={(event) => setNotesForm({ ...notesForm, closingNotes: event.target.value })}
              placeholder="Shown to guests after the auction is closed."
            />
          </label>
          <button className="button w-full sm:w-auto" type="submit">
            Save auction notes
          </button>
        </motion.form>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_1.4fr]">
          <motion.form layout className="card min-w-0 space-y-4" onSubmit={importSheet}>
            <div className="flex items-center gap-2">
              <Sheet size={18} />
              <h2 className="font-semibold">Sheet import</h2>
            </div>
            <input
              className="input"
              placeholder="Google Sheet URL or ID"
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              required
            />
            <button className="button w-full" type="submit">
              Import catalog
            </button>
          </motion.form>

          <section className="card min-w-0 space-y-5">
            <div className="flex items-center gap-2">
              <UserPlus size={18} />
              <h2 className="font-semibold">Guest list</h2>
            </div>

            <form className="grid min-w-0 gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={saveGuest}>
              <input
                className="input"
                placeholder="Guest name"
                value={guestForm.displayName}
                onChange={(event) => setGuestForm({ ...guestForm, displayName: event.target.value })}
                required
              />
              <input
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={US_PHONE_PLACEHOLDER}
                value={guestForm.phone}
                onChange={(event) => setGuestForm({ ...guestForm, phone: event.target.value })}
                required
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button className="button" type="submit">
                  {editingGuest ? "Save" : "Add"}
                </button>
                {editingGuest && (
                  <button className="button-ghost" type="button" onClick={resetGuestForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="space-y-3 sm:hidden">
              {guests.map((guest) => (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4" key={guest.phoneHash}>
                  <p className="font-semibold">{guest.displayName}</p>
                  <p className="mt-1 wrap-break-word text-sm text-slate-600">
                    {guest.normalizedPhone ?? "Phone not stored"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="button-secondary flex-1 px-4 py-2"
                      aria-label={`Edit ${guest.displayName}`}
                      onClick={() => editGuest(guest)}
                    >
                      Edit
                    </button>
                    <button
                      className="button-secondary flex-1 px-4 py-2"
                      aria-label={`Remove ${guest.displayName}`}
                      onClick={() => removeGuest(guest)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-3">Guest</th>
                    <th>Phone</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {guests.map((guest) => (
                    <tr className="border-t border-slate-100" key={guest.phoneHash}>
                      <td className="py-3 font-medium">{guest.displayName}</td>
                      <td>{guest.normalizedPhone ?? "Phone not stored"}</td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Edit ${guest.displayName}`}
                          onClick={() => editGuest(guest)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Remove ${guest.displayName}`}
                          onClick={() => removeGuest(guest)}
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
    </div>
  );
}

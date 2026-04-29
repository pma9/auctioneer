import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { readAuctionItemsFromSheet } from "@/lib/google/sheets";
import { adminDb } from "@/lib/firebase/admin";
import { requireAuctionAdmin, requireUser } from "@/lib/firebase/server-auth";

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    const user = await requireUser(request);
    await requireAuctionAdmin(auctionId, user);

    const { sheetUrlOrId } = (await request.json()) as { sheetUrlOrId?: string };
    if (!sheetUrlOrId) return NextResponse.json({ error: "Sheet URL or ID is required." }, { status: 400 });

    const { sheetId, items, skippedRows } = await readAuctionItemsFromSheet(sheetUrlOrId);
    const existingSnapshot = await adminDb.collection(`auctions/${auctionId}/items`).get();
    const existingByName = new Map(existingSnapshot.docs.map((doc) => [doc.get("normalizedName"), doc.ref]));

    const batch = adminDb.batch();
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const existingRef = existingByName.get(item.normalizedName);
      const ref = existingRef ?? adminDb.collection(`auctions/${auctionId}/items`).doc();
      const lifecycleFields = existingRef
        ? {}
        : {
            createdAt: FieldValue.serverTimestamp(),
          };
      batch.set(
        ref,
        {
          ...item,
          ...(!existingRef && !item.status ? { status: "open" } : {}),
          sourceSheetId: sheetId,
          ...lifecycleFields,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (existingRef) {
        updated++;
      } else {
        created++;
      }
    }

    await batch.commit();
    return NextResponse.json({
      ok: true,
      created,
      updated,
      total: items.length,
      skipped: skippedRows.length,
      skippedRows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to import sheet." },
      { status: 400 },
    );
  }
}

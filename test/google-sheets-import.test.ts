import { describe, expect, it } from "vitest";
import { parseAuctionItemRows } from "@/lib/google/sheets";

describe("google sheets import parsing", () => {
  it("matches imperfect headers and parses currency values", () => {
    const { items, skippedRows } = parseAuctionItemRows([
      ["Item Name", "Item Notes", "Retail Price", "Starting Bid", "Buy Now Price"],
      ["Signed Jersey", "Framed with certificate", "$1,250", "$100", "1,500.00"],
    ]);

    expect(skippedRows).toHaveLength(0);
    expect(items[0]).toMatchObject({
      name: "Signed Jersey",
      notes: "Framed with certificate",
      msrp: 1250,
      startingPrice: 100,
      lockInPrice: 1500,
      normalizedName: "signed jersey",
      sourceRow: 2,
    });
    expect(items[0].status).toBeUndefined();
  });

  it("can read item fields beyond the first five columns", () => {
    const { items } = parseAuctionItemRows([
      ["Ignored", "Title", "Details", "Retail", "Ignored", "Ignored", "Opening Bid", "Instant Buy"],
      ["x", "VIP Tickets", "Four seats", "$800", "x", "x", "$250", "$1,000"],
    ]);

    expect(items[0]).toMatchObject({
      name: "VIP Tickets",
      notes: "Four seats",
      msrp: 800,
      startingPrice: 250,
      lockInPrice: 1000,
    });
  });

  it("defaults blank optional MSRP to zero", () => {
    const { items, skippedRows } = parseAuctionItemRows([
      ["Item", "Notes", "MSRP", "Start Price", "Lock-In Price"],
      ["Signed Ball", "", "", "25", "$100"],
    ]);

    expect(skippedRows).toHaveLength(0);
    expect(items[0].msrp).toBe(0);
  });

  it("imports named rows with dirty required prices as invalid items", () => {
    const { items, skippedRows } = parseAuctionItemRows([
      ["Item", "Notes", "MSRP", "Start Price", "Lock-In Price"],
      ["Mystery Box", "Needs pricing", "$50", "TBD", "$100"],
      ["", "", "", "", ""],
      ["Gift Card", "", "$100", "$25", "$150"],
      ["Silent Auction", "Missing prices", "$100", "", ""],
    ]);

    expect(skippedRows).toHaveLength(0);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      name: "Mystery Box",
      startingPrice: 0,
      lockInPrice: 100,
      status: "invalid",
      importValidationErrors: ["Starting price is not a valid non-negative number."],
    });
    expect(items[1].name).toBe("Gift Card");
    expect(items[1].status).toBeUndefined();
    expect(items[2]).toMatchObject({
      name: "Silent Auction",
      startingPrice: 0,
      lockInPrice: 0,
      status: "invalid",
      importValidationErrors: ["Starting price is missing.", "Lock-in price is missing."],
    });
  });

  it("skips non-blank rows without an item name", () => {
    const { items, skippedRows } = parseAuctionItemRows([
      ["Item", "Notes", "MSRP", "Start Price", "Lock-In Price"],
      ["", "Needs an item name", "$50", "$10", "$100"],
    ]);

    expect(items).toHaveLength(0);
    expect(skippedRows).toEqual([{ sourceRow: 2, reason: "Item name is missing." }]);
  });
});

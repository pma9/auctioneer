import { describe, expect, it } from "vitest";
import {
  compareItemsByPublishedAtDesc,
  firestoreTimestampToMs,
  isItemHighlightedForLatestPublishBatch,
  publishWaveIsAfterAuctionGoLive,
  shouldShowNewItemsNotice,
  sortItemsByPublishedAtDesc,
} from "@/lib/auction/item-notifications";
import type { Auction, AuctionItem } from "@/lib/auction/types";

function baseItem(partial: Partial<AuctionItem>): AuctionItem {
  return {
    id: "i1",
    name: "A",
    normalizedName: "a",
    notes: "",
    msrp: 0,
    startingPrice: 0,
    lockInPrice: 0,
    status: "open",
    ...partial,
  };
}

describe("item-notifications", () => {
  it("firestoreTimestampToMs supports seconds shape", () => {
    expect(firestoreTimestampToMs({ seconds: 1000, nanoseconds: 0 })).toBe(1_000_000);
    expect(firestoreTimestampToMs({ seconds: 10, nanoseconds: 500_000_000 })).toBe(10_500);
    expect(firestoreTimestampToMs(null)).toBeNull();
  });

  it("publishWaveIsAfterAuctionGoLive skips bootstrap catalog and pending previews", () => {
    const base: Pick<Auction, "latestItemsPublishedAt" | "openedAt" | "reopenedAt"> = {
      latestItemsPublishedAt: { seconds: 10, nanoseconds: 0 },
      openedAt: { seconds: 20, nanoseconds: 0 },
    };
    expect(publishWaveIsAfterAuctionGoLive(base)).toBe(false);
    expect(
      publishWaveIsAfterAuctionGoLive({
        ...base,
        latestItemsPublishedAt: { seconds: 21, nanoseconds: 0 },
      }),
    ).toBe(true);

    expect(
      publishWaveIsAfterAuctionGoLive({
        latestItemsPublishedAt: { seconds: 5, nanoseconds: 0 },
        openedAt: undefined,
        reopenedAt: undefined,
      }),
    ).toBe(false);

    expect(
      publishWaveIsAfterAuctionGoLive({
        latestItemsPublishedAt: { seconds: 30, nanoseconds: 0 },
        openedAt: { seconds: 10, nanoseconds: 0 },
        reopenedAt: { seconds: 20, nanoseconds: 0 },
      }),
    ).toBe(true);

    expect(
      publishWaveIsAfterAuctionGoLive({
        latestItemsPublishedAt: { seconds: 15, nanoseconds: 0 },
        openedAt: { seconds: 10, nanoseconds: 0 },
        reopenedAt: { seconds: 20, nanoseconds: 0 },
      }),
    ).toBe(false);
  });

  it("shouldShowNewItemsNotice compares latest to dismissed", () => {
    expect(shouldShowNewItemsNotice({ seconds: 10, nanoseconds: 0 }, null)).toBe(true);
    expect(shouldShowNewItemsNotice({ seconds: 10, nanoseconds: 0 }, { seconds: 9, nanoseconds: 0 })).toBe(
      true,
    );
    expect(shouldShowNewItemsNotice({ seconds: 10, nanoseconds: 0 }, { seconds: 10, nanoseconds: 0 })).toBe(
      false,
    );
    expect(shouldShowNewItemsNotice({ seconds: 10, nanoseconds: 0 }, { seconds: 11, nanoseconds: 0 })).toBe(
      false,
    );
  });

  it("sortItemsByPublishedAtDesc orders by publishedAt descending", () => {
    const items = [
      baseItem({ id: "old", name: "Old", publishedAt: { seconds: 1, nanoseconds: 0 } }),
      baseItem({ id: "new", name: "New", publishedAt: { seconds: 3, nanoseconds: 0 } }),
      baseItem({ id: "mid", name: "Mid", publishedAt: { seconds: 2, nanoseconds: 0 } }),
      baseItem({ id: "nodate", name: "No date" }),
    ];
    const sorted = sortItemsByPublishedAtDesc(items).map((i) => i.id);
    expect(sorted).toEqual(["new", "mid", "old", "nodate"]);
  });

  it("compareItemsByPublishedAtDesc tie-breaks by name then id", () => {
    const a = baseItem({
      id: "b",
      name: "Same",
      publishedAt: { seconds: 5, nanoseconds: 0 },
    });
    const b = baseItem({
      id: "a",
      name: "Same",
      publishedAt: { seconds: 5, nanoseconds: 0 },
    });
    // Same publish time and name: sort by id ascending
    expect(compareItemsByPublishedAtDesc(a, b)).toBeGreaterThan(0);
    expect(compareItemsByPublishedAtDesc(b, a)).toBeLessThan(0);
  });

  it("isItemHighlightedForLatestPublishBatch matches marker or sequential-commit slack", () => {
    expect(
      isItemHighlightedForLatestPublishBatch(baseItem({ publishedAt: { seconds: 10, nanoseconds: 0 } }), {
        seconds: 10,
        nanoseconds: 0,
      }),
    ).toBe(true);
    const item = baseItem({ publishedAt: { seconds: 10, nanoseconds: 500_000_000 } });
    expect(isItemHighlightedForLatestPublishBatch(item, { seconds: 10, nanoseconds: 520_000_000 })).toBe(
      true,
    );
    expect(isItemHighlightedForLatestPublishBatch(item, { seconds: 12, nanoseconds: 0 })).toBe(false);
    expect(
      isItemHighlightedForLatestPublishBatch(baseItem({ publishedAt: undefined }), {
        seconds: 10,
        nanoseconds: 0,
      }),
    ).toBe(false);
  });
});

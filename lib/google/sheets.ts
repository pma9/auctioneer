import { google } from "googleapis";
import { z } from "zod";
import { normalizeItemName } from "@/lib/auction/calculations";

const rowSchema = z.object({
  name: z.string().min(1),
  notes: z.string().default(""),
  msrp: z.coerce.number().nonnegative().default(0),
  startingPrice: z.coerce.number().nonnegative(),
  lockInPrice: z.coerce.number().nonnegative(),
});

export type SheetItemRow = z.infer<typeof rowSchema> & {
  normalizedName: string;
  sourceRow: number;
};

export function extractSheetId(sheetUrlOrId: string) {
  const match = sheetUrlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? sheetUrlOrId.trim();
}

export async function readAuctionItemsFromSheet(sheetUrlOrId: string) {
  const sheetId = extractSheetId(sheetUrlOrId);
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "A:E",
  });

  const rows = response.data.values ?? [];
  const [headers, ...body] = rows;
  const headerMap = mapHeaders(headers ?? []);

  const items = body.flatMap((row, index) => {
    const parsed = rowSchema.safeParse({
      name: valueAt(row, headerMap, "name", 0),
      notes: valueAt(row, headerMap, "notes", 1),
      msrp: valueAt(row, headerMap, "msrp", 2),
      startingPrice: valueAt(row, headerMap, "starting price", 3),
      lockInPrice: valueAt(row, headerMap, "lock in price", 4),
    });

    if (!parsed.success) return [];

    return {
      ...parsed.data,
      normalizedName: normalizeItemName(parsed.data.name),
      sourceRow: index + 2,
    };
  });

  return { sheetId, items };
}

function mapHeaders(headers: string[]) {
  return new Map(headers.map((header, index) => [normalizeHeader(header), index]));
}

function valueAt(row: string[], headerMap: Map<string, number>, header: string, fallbackIndex: number) {
  return row[headerMap.get(header) ?? fallbackIndex] ?? "";
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[_-]/g, " ");
}

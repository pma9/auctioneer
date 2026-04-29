import { google } from "googleapis";
import { z } from "zod";
import { normalizeItemName } from "@/lib/auction/calculations";

const rowSchema = z.object({
  name: z.string().trim().min(1),
  notes: z.string().default(""),
  msrp: z.number().nonnegative().default(0),
  startingPrice: z.number().nonnegative(),
  lockInPrice: z.number().nonnegative(),
});

export type SheetItemRow = z.infer<typeof rowSchema> & {
  normalizedName: string;
  sourceRow: number;
  status?: "invalid";
  importValidationErrors?: string[];
};

export type SkippedSheetRow = {
  sourceRow: number;
  reason: string;
};

type SheetCell = string | number | boolean | null | undefined;
type SheetField = "name" | "notes" | "msrp" | "startingPrice" | "lockInPrice";

const fieldAliases: Record<SheetField, string[]> = {
  name: ["name", "item", "item name", "title", "product", "description"],
  notes: ["notes", "note", "details", "item notes", "description"],
  msrp: ["msrp", "retail", "retail price", "value", "estimated value"],
  startingPrice: ["starting price", "start price", "starting bid", "opening bid", "minimum bid", "min bid"],
  lockInPrice: ["lock in price", "lock-in price", "lockin price", "buy now", "buy now price", "instant buy"],
};

const fallbackIndexes: Record<SheetField, number> = {
  name: 0,
  notes: 1,
  msrp: 2,
  startingPrice: 3,
  lockInPrice: 4,
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
    range: "A:Z",
  });

  const rows = (response.data.values ?? []) as SheetCell[][];
  const { items, skippedRows } = parseAuctionItemRows(rows);

  return { sheetId, items, skippedRows };
}

export function parseAuctionItemRows(rows: SheetCell[][]) {
  const [headers, ...body] = rows;
  const headerMap = mapHeaders(headers ?? []);

  return body.reduce<{ items: SheetItemRow[]; skippedRows: SkippedSheetRow[] }>(
    (result, row, index) => {
      if (isBlankRow(row)) return result;

      const sourceRow = index + 2;
      const parsed = parseAuctionItemRow(row, headerMap, sourceRow);

      if (parsed.success) {
        result.items.push(parsed.item);
      } else {
        result.skippedRows.push({ sourceRow, reason: parsed.reason });
      }

      return result;
    },
    { items: [], skippedRows: [] },
  );
}

function parseAuctionItemRow(row: SheetCell[], headerMap: Map<string, number>, sourceRow: number) {
  const name = stringValue(valueAt(row, headerMap, "name")).trim();
  if (!name) return { success: false as const, reason: "Item name is missing." };

  const msrp = parsePrice(valueAt(row, headerMap, "msrp"), "MSRP", false);
  const startingPrice = parsePrice(valueAt(row, headerMap, "startingPrice"), "Starting price", true);
  const lockInPrice = parsePrice(valueAt(row, headerMap, "lockInPrice"), "Lock-in price", true);
  const importValidationErrors = [msrp.error, startingPrice.error, lockInPrice.error].filter(isString);
  const parsed = rowSchema.safeParse({
    name,
    notes: stringValue(valueAt(row, headerMap, "notes")),
    msrp: msrp.value,
    startingPrice: startingPrice.value,
    lockInPrice: lockInPrice.value,
  });

  if (!parsed.success) {
    return { success: false as const, reason: formatRowError(parsed.error) };
  }

  return {
    success: true as const,
    item: {
      ...parsed.data,
      normalizedName: normalizeItemName(parsed.data.name),
      sourceRow,
      ...(startingPrice.error || lockInPrice.error
        ? { status: "invalid" as const, importValidationErrors }
        : {}),
    },
  };
}

function mapHeaders(headers: SheetCell[]) {
  return new Map(headers.map((header, index) => [normalizeHeader(stringValue(header)), index]));
}

function valueAt(row: SheetCell[], headerMap: Map<string, number>, field: SheetField) {
  const headerIndex = fieldAliases[field]
    .map((alias) => headerMap.get(normalizeHeader(alias)))
    .find(isNumber);
  return row[headerIndex ?? fallbackIndexes[field]];
}

function normalizeHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function parsePrice(value: SheetCell, label: string, required: boolean) {
  if (typeof value === "number") {
    return value >= 0 ? { value } : { value: 0, error: `${label} is not a valid non-negative number.` };
  }

  const trimmed = stringValue(value).trim();
  if (!trimmed) return required ? { value: 0, error: `${label} is missing.` } : { value: 0 };

  const normalized = trimmed.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { value: 0, error: `${label} is not a valid non-negative number.` };
  }

  return { value: Number(normalized) };
}

function stringValue(value: SheetCell) {
  return value == null ? "" : String(value);
}

function isBlankRow(row: SheetCell[]) {
  return row.every((cell) => !stringValue(cell).trim());
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function formatRowError(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const field = issue.path.join(".") || "row";
      if (field === "name") return "Item name is missing.";
      if (field === "msrp") return "MSRP must be a valid non-negative number or currency amount.";
      if (field === "startingPrice")
        return "Starting price is missing or is not a valid non-negative number.";
      if (field === "lockInPrice") return "Lock-in price is missing or is not a valid non-negative number.";
      return `${field}: ${issue.message}`;
    })
    .join("; ");
}

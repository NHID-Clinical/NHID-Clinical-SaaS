/**
 * Call-volume evidence parsing.
 *
 * This is an evidence pipeline, so the guiding rule is: never return a
 * plausible number derived from a file we did not fully understand. Every
 * malformed row is an error naming the row and the offending value, not a
 * silently skipped line.
 */

export class CallVolumeCsvError extends Error {
  constructor(
    message: string,
    readonly row?: number
  ) {
    super(message);
    this.name = "CallVolumeCsvError";
  }
}

/**
 * RFC 4180 field splitter: honours quoted fields, embedded commas and
 * newlines, and doubled quotes as an escape.
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;

  const endField = () => {
    row.push(field.trim());
    field = "";
    started = true;
  };
  const endRow = () => {
    endField();
    // Drop trailing blank lines, but keep genuinely empty interior cells.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
      continue;
    }
    if (char === ",") {
      endField();
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    throw new CallVolumeCsvError(
      "The file ends inside an unclosed quoted value."
    );
  }
  if (field !== "" || started || row.length) endRow();

  return rows;
}

const VOLUME_HEADERS = ["calls", "call_volume", "total_calls", "volume"];
const WEEK_HEADERS = [
  "week",
  "week_start",
  "weekstart",
  "week_starting",
  "date",
  "period",
];

export type CallVolumeWeek = { weekStart: Date; totalCalls: number };

export type CallVolumeSummary = {
  /** Number of data rows read (excludes the header). */
  rows: number;
  /** Weeks after merging duplicate week values. */
  weeks: CallVolumeWeek[];
  totalCalls: number;
};

function parseWeek(raw: string, rowNumber: number): Date {
  const value = raw.trim();
  if (!value) {
    throw new CallVolumeCsvError(`Row ${rowNumber}: the week value is empty.`);
  }
  // Anchor bare YYYY-MM-DD to UTC so the stored week does not drift by a day
  // depending on where the server runs.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new CallVolumeCsvError(
      `Row ${rowNumber}: "${raw}" is not a recognizable date.`,
      rowNumber
    );
  }
  return parsed;
}

function parseVolume(raw: string, rowNumber: number): number {
  const value = raw.trim().replace(/,/g, "");
  if (!value) {
    throw new CallVolumeCsvError(
      `Row ${rowNumber}: the call-volume value is empty.`,
      rowNumber
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new CallVolumeCsvError(
      `Row ${rowNumber}: "${raw}" is not a non-negative whole number of calls.`,
      rowNumber
    );
  }
  return parsed;
}

export function parseCallVolumeCsv(csvContent: string): CallVolumeSummary {
  const rows = parseCsv(csvContent);
  if (rows.length < 2) {
    throw new CallVolumeCsvError(
      "The file must include a header row and at least one data row."
    );
  }

  const headers = rows[0].map(header => header.toLowerCase());
  const volumeIndex = headers.findIndex(header =>
    VOLUME_HEADERS.includes(header)
  );
  const weekIndex = headers.findIndex(header => WEEK_HEADERS.includes(header));

  if (volumeIndex === -1) {
    throw new CallVolumeCsvError(
      `A call-volume column is required. Expected one of: ${VOLUME_HEADERS.join(", ")}.`
    );
  }
  if (weekIndex === -1) {
    throw new CallVolumeCsvError(
      `A week column is required so volumes can be attributed to a period. Expected one of: ${WEEK_HEADERS.join(", ")}.`
    );
  }

  const byWeek = new Map<number, number>();
  let dataRows = 0;

  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2; // 1-based, counting the header

    if (row.every(cell => cell === "")) return;
    if (row.length <= Math.max(volumeIndex, weekIndex)) {
      throw new CallVolumeCsvError(
        `Row ${rowNumber}: expected at least ${Math.max(volumeIndex, weekIndex) + 1} columns but found ${row.length}.`,
        rowNumber
      );
    }

    const weekStart = parseWeek(row[weekIndex], rowNumber);
    const totalCalls = parseVolume(row[volumeIndex], rowNumber);
    const key = weekStart.getTime();
    byWeek.set(key, (byWeek.get(key) ?? 0) + totalCalls);
    dataRows += 1;
  });

  if (!dataRows) {
    throw new CallVolumeCsvError("The file contains no data rows.");
  }

  const weeks = [...byWeek.entries()]
    .map(([time, totalCalls]) => ({ weekStart: new Date(time), totalCalls }))
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

  return {
    rows: dataRows,
    weeks,
    totalCalls: weeks.reduce((sum, week) => sum + week.totalCalls, 0),
  };
}

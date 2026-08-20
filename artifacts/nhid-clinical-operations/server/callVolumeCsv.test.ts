import { describe, expect, it } from "vitest";
import {
  CallVolumeCsvError,
  parseCallVolumeCsv,
  parseCsv,
} from "./callVolumeCsv";

const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("parseCsv", () => {
  it("honours quoted fields containing commas", () => {
    expect(parseCsv('site,calls\n"Clinic A, North",120')).toEqual([
      ["site", "calls"],
      ["Clinic A, North", "120"],
    ]);
  });

  it("honours doubled quotes as an escape", () => {
    expect(parseCsv('name\n"The ""Main"" Clinic"')).toEqual([
      ["name"],
      ['The "Main" Clinic'],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("rejects a file that ends inside an open quote", () => {
    expect(() => parseCsv('name\n"unterminated')).toThrow(CallVolumeCsvError);
  });
});

describe("parseCallVolumeCsv", () => {
  it("parses a well-formed evidence file", () => {
    const result = parseCallVolumeCsv(
      "week,calls\n2026-08-03,120\n2026-08-10,145"
    );
    expect(result.rows).toBe(2);
    expect(result.totalCalls).toBe(265);
    expect(result.weeks.map(week => iso(week.weekStart))).toEqual([
      "2026-08-03",
      "2026-08-10",
    ]);
  });

  it("no longer loses rows whose site name contains a comma", () => {
    const result = parseCallVolumeCsv(
      'site,week,calls\n"Clinic A, North",2026-08-03,120\n"Clinic B, South",2026-08-10,145'
    );
    expect(result.totalCalls).toBe(265);
  });

  it("rejects an unparseable value instead of silently skipping it", () => {
    expect(() =>
      parseCallVolumeCsv("week,calls\n2026-08-03,120\n2026-08-10,N/A")
    ).toThrow(/Row 3.*N\/A/);
  });

  it("names the offending row for a bad date", () => {
    expect(() =>
      parseCallVolumeCsv("week,calls\n2026-08-03,120\nnot-a-date,145")
    ).toThrow(/Row 3.*not-a-date/);
  });

  it("rejects negative and fractional call counts", () => {
    expect(() => parseCallVolumeCsv("week,calls\n2026-08-03,-4")).toThrow(
      /non-negative whole number/
    );
    expect(() => parseCallVolumeCsv("week,calls\n2026-08-03,12.5")).toThrow(
      /non-negative whole number/
    );
  });

  it("requires both a volume column and a week column", () => {
    expect(() => parseCallVolumeCsv("week,widgets\n2026-08-03,10")).toThrow(
      /call-volume column is required/
    );
    expect(() => parseCallVolumeCsv("site,calls\nClinic,10")).toThrow(
      /week column is required/
    );
  });

  it("requires at least one data row", () => {
    expect(() => parseCallVolumeCsv("week,calls")).toThrow(
      /header row and at least one data row/
    );
  });

  it("accepts thousands separators inside quoted numbers", () => {
    expect(
      parseCallVolumeCsv('week,calls\n2026-08-03,"1,240"').totalCalls
    ).toBe(1240);
  });

  it("merges duplicate weeks rather than emitting conflicting rows", () => {
    const result = parseCallVolumeCsv(
      "week,calls\n2026-08-03,100\n2026-08-03,40"
    );
    expect(result.rows).toBe(2);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].totalCalls).toBe(140);
  });

  it("anchors bare dates to UTC so the week does not drift by timezone", () => {
    const [week] = parseCallVolumeCsv("week,calls\n2026-08-03,10").weeks;
    expect(week.weekStart.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

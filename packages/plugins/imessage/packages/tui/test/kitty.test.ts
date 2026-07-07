import { describe, expect, test } from "bun:test";
import {
  fitGrid,
  idColor,
  MAX_COLS,
  MAX_ROWS,
  placeholderRows,
  pngSize,
  transmitEscape,
} from "../src/kitty.ts";

// 1×1 PNG (smallest valid) for header parsing.
const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("pngSize", () => {
  test("reads IHDR dimensions", () => {
    expect(pngSize(PNG_1x1)).toEqual({ width: 1, height: 1 });
  });

  test("rejects non-PNG bytes", () => {
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBeNull();
    expect(pngSize(new Uint8Array(4))).toBeNull();
  });
});

describe("fitGrid", () => {
  test("wide image clamps to max columns", () => {
    const grid = fitGrid({ width: 2000, height: 500 });
    expect(grid.cols).toBe(MAX_COLS);
    // aspect 4:1 with 2:1 cells → rows = cols / 8
    expect(grid.rows).toBe(Math.round(MAX_COLS / 8));
  });

  test("tall image clamps to max rows", () => {
    const grid = fitGrid({ width: 500, height: 2000 });
    expect(grid.rows).toBe(MAX_ROWS);
    expect(grid.cols).toBe(Math.round((MAX_ROWS * 2) / 4));
  });

  test("never returns zero cells", () => {
    expect(fitGrid({ width: 10000, height: 1 }).rows).toBe(1);
    expect(fitGrid({ width: 1, height: 10000 }).cols).toBe(1);
  });
});

describe("placeholderRows", () => {
  test("emits one 3-codepoint cluster per cell with row/col diacritics", () => {
    const rows = placeholderRows({ cols: 3, rows: 2 });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const points = [...row];
      expect(points).toHaveLength(9); // 3 cells × (placeholder + 2 diacritics)
      expect(points[0]).toBe("\u{10EEEE}");
    }
    // Row diacritic varies by row, column diacritic by cell.
    const [r0, r1] = rows.map((r) => [...r]);
    expect(r0![1]).not.toBe(r1![1]!);
    expect(r0![2]).toBe(r1![2]!);
    expect(r0![2]).not.toBe(r0![5]!);
  });
});

describe("transmitEscape", () => {
  test("single chunk carries all keys and final m=0", () => {
    const apc = transmitEscape(0x0102fb, PNG_1x1);
    expect(apc.startsWith("\x1b_Gq=2,a=T,U=1,C=1,f=100,i=66299,m=0;")).toBe(true);
    expect(apc.endsWith("\x1b\\")).toBe(true);
    const b64 = apc.slice(apc.indexOf(";") + 1, -2);
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(PNG_1x1);
  });

  test("large payloads chunk at 4096 with m=1 continuations", () => {
    const big = new Uint8Array(9000); // → 12000 base64 chars → 3 chunks
    const apc = transmitEscape(7, big);
    const parts = apc.split("\x1b\\").filter(Boolean);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("i=7,m=1;");
    expect(parts[1]!.startsWith("\x1b_Gq=2,m=1;")).toBe(true);
    expect(parts[2]!.startsWith("\x1b_Gq=2,m=0;")).toBe(true);
    // Chunks reassemble to the original payload.
    const b64 = parts.map((p) => p.slice(p.indexOf(";") + 1)).join("");
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(big);
  });
});

describe("idColor", () => {
  test("encodes the image id as 24-bit hex fg", () => {
    expect(idColor(0x0102fb)).toBe("#0102fb");
    expect(idColor(0xff000001)).toBe("#000001"); // masked to 24 bits
  });
});

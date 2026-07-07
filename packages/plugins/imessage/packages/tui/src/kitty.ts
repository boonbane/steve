import type { CliRenderer, TerminalCapabilities } from "@opentui/core";

// Inline images over the Kitty graphics protocol, Unicode-placeholder flavor
// (the same mechanism yazi's kgp driver uses):
//
//  1. The PNG bytes are transmitted once per attachment as chunked base64 in
//     APC escapes with `U=1`, registering a *virtual placement* under an image
//     id. Nothing is drawn; the terminal just holds the pixels. `f=100` means
//     the terminal decodes the PNG itself — no decoding on our side.
//  2. Placement is ordinary text: rows of U+10EEEE placeholder cells, each
//     tagged with row/column combining diacritics, with the foreground color
//     encoding the image id. The terminal swaps each such cell for the
//     matching tile of the image.
//
// Because step 2 is plain text, opentui composites, scrolls, and clips the
// image like any other content (verified: the renderer keeps the 3-codepoint
// cluster as one cell and passes the fg color through verbatim). Only step 1
// bypasses the compositor, through the renderer's own serialized output
// channel (`writeOut`), so an escape can never be torn mid-frame.

const PLACEHOLDER = "\u{10EEEE}";

// Row/column index diacritics, in kitty's spec order (first 64 of 297 — grids
// here are capped far below that).
const DIACRITICS = [
  "\u{0305}", "\u{030d}", "\u{030e}", "\u{0310}", "\u{0312}", "\u{033d}",
  "\u{033e}", "\u{033f}", "\u{0346}", "\u{034a}", "\u{034b}", "\u{034c}",
  "\u{0350}", "\u{0351}", "\u{0352}", "\u{0357}", "\u{035b}", "\u{0363}",
  "\u{0364}", "\u{0365}", "\u{0366}", "\u{0367}", "\u{0368}", "\u{0369}",
  "\u{036a}", "\u{036b}", "\u{036c}", "\u{036d}", "\u{036e}", "\u{036f}",
  "\u{0483}", "\u{0484}", "\u{0485}", "\u{0486}", "\u{0487}", "\u{0592}",
  "\u{0593}", "\u{0594}", "\u{0595}", "\u{0597}", "\u{0598}", "\u{0599}",
  "\u{059c}", "\u{059d}", "\u{059e}", "\u{059f}", "\u{05a0}", "\u{05a1}",
  "\u{05a8}", "\u{05a9}", "\u{05ab}", "\u{05ac}", "\u{05af}", "\u{05c4}",
  "\u{0610}", "\u{0611}", "\u{0612}", "\u{0613}", "\u{0614}", "\u{0615}",
  "\u{0616}", "\u{0617}", "\u{0657}", "\u{0658}",
];

// Terminal cells are roughly twice as tall as wide; used to keep the aspect
// ratio right when converting pixel dimensions to a cell grid.
const CELL_ASPECT = 2;

export const MAX_COLS = 42;
export const MAX_ROWS = 18;

export type Grid = { cols: number; rows: number };

// writeOut is TS-private on CliRenderer but is the supported-by-behavior way
// to interleave raw sequences with frames: it routes through the native
// renderer's output channel, so it serializes with frame writes even when
// rendering is threaded.
type RawWriter = { writeOut(chunk: string): void };

export function kittyGraphicsSupported(
  capabilities: TerminalCapabilities | null,
): boolean {
  return capabilities?.kitty_graphics === true;
}

// Width/height straight out of the PNG header (IHDR is always first, at a
// fixed offset) — no decoding.
export function pngSize(data: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || !signature.every((byte, i) => data[i] === byte)) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// Fit pixel dimensions into the cell-grid budget, preserving aspect ratio.
export function fitGrid(
  size: { width: number; height: number },
  maxCols = MAX_COLS,
  maxRows = MAX_ROWS,
): Grid {
  let cols = maxCols;
  let rows = Math.round((cols * size.height) / (size.width * CELL_ASPECT));
  if (rows > maxRows) {
    rows = maxRows;
    cols = Math.round((rows * CELL_ASPECT * size.width) / size.height);
  }
  return { cols: Math.max(1, Math.min(cols, maxCols)), rows: Math.max(1, rows) };
}

// The image id doubles as the placeholder fg color (24-bit).
export function idColor(id: number): string {
  return `#${(id & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function placeholderRows(grid: Grid): string[] {
  const rows: string[] = [];
  for (let y = 0; y < grid.rows; y++) {
    let row = "";
    for (let x = 0; x < grid.cols; x++) {
      row += PLACEHOLDER + DIACRITICS[y]! + DIACRITICS[x]!;
    }
    rows.push(row);
  }
  return rows;
}

// APC transmission: q=2 silences terminal responses (they would land in the
// stdin parser), U=1 makes the placement virtual, f=100 is PNG passthrough.
export function transmitEscape(id: number, png: Uint8Array): string {
  const b64 = Buffer.from(png).toString("base64");
  let out = "";
  for (let i = 0; i < b64.length; i += 4096) {
    const chunk = b64.slice(i, i + 4096);
    const more = i + 4096 < b64.length ? 1 : 0;
    out +=
      i === 0
        ? `\x1b_Gq=2,a=T,U=1,C=1,f=100,i=${id & 0xffffff},m=${more};${chunk}\x1b\\`
        : `\x1b_Gq=2,m=${more};${chunk}\x1b\\`;
  }
  return out;
}

const DELETE_ALL = "\x1b_Gq=2,a=d,d=A\x1b\\";

// Ids already living in the terminal, so each attachment transmits once per
// session. Flushed wholesale if it ever grows silly (placeholder cells on
// screen at that moment go blank until their rows re-render, which is rare
// enough not to matter).
const transmitted = new Set<number>();
const TRANSMIT_CAP = 256;

export function ensureTransmitted(
  renderer: CliRenderer,
  id: number,
  png: Uint8Array,
): void {
  const key = id & 0xffffff;
  if (transmitted.has(key)) return;
  const writer = renderer as unknown as RawWriter;
  if (transmitted.size >= TRANSMIT_CAP) {
    writer.writeOut(DELETE_ALL);
    transmitted.clear();
  }
  writer.writeOut(transmitEscape(key, png));
  transmitted.add(key);
}

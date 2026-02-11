import { defaultTheme as theme } from "./theme";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

type TruncateMode = "start" | "middle" | "end";

export type TableOptions = {
  maxWidth?: number;
  flex?: number[];
  noTruncate?: boolean[];
  truncate?: TruncateMode[];
  format?: Array<(value: string, row: number, col: number) => string>;
  maxRows?: number;
};

function clean(value: string): string {
  return value.replace(/[\t\n]/g, " ").replace(ANSI_RE, "");
}

function truncateMiddle(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);

  const tail = Math.floor((width - 3) / 2);
  const head = width - 3 - tail;
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function truncateStart(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return "...".slice(0, width);

  return `...${value.slice(value.length - (width - 3))}`;
}

function truncateEnd(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return "...".slice(0, width);

  return `${value.slice(0, width - 3)}...`;
}

function truncate(value: string, width: number, mode: TruncateMode): string {
  if (mode === "start") return truncateStart(value, width);
  if (mode === "end") return truncateEnd(value, width);
  return truncateMiddle(value, width);
}

function fitWidths(
  natural: number[],
  available: number,
  flex: number[],
  noTruncate: boolean[],
): number[] {
  const widths = [...natural];
  const totalNatural = natural.reduce((sum, width) => sum + width, 0);

  if (totalNatural <= available) {
    return widths;
  }

  let fixedWidth = 0;
  const dynamic: Array<{ index: number; weight: number }> = [];

  for (let index = 0; index < widths.length; index++) {
    if (noTruncate[index] || flex[index] === 0) {
      fixedWidth += widths[index] ?? 0;
      continue;
    }

    dynamic.push({ index, weight: flex[index] ?? 1 });
  }

  const remaining = Math.max(0, available - fixedWidth);

  if (dynamic.length === 0) {
    return widths;
  }

  const totalWeight = dynamic.reduce((sum, item) => sum + item.weight, 0);
  let used = 0;

  for (const item of dynamic) {
    const share = Math.floor((remaining * item.weight) / totalWeight);
    const width = Math.max(1, share);
    widths[item.index] = width;
    used += width;
  }

  let extra = remaining - used;
  let cursor = 0;
  while (extra > 0) {
    const item = dynamic[cursor % dynamic.length]!;
    widths[item.index] = (widths[item.index] ?? 0) + 1;
    extra--;
    cursor++;
  }

  return widths;
}

export function table(
  headers: string[],
  columns: string[][],
  options: TableOptions = {},
): void {
  if (headers.length === 0) return;

  const count = headers.length;
  const gap = 2;
  const rows = columns.reduce((max, column) => Math.max(max, column.length), 0);
  const visibleRows = Math.min(rows, options.maxRows ?? rows);

  const natural: number[] = [];

  for (let col = 0; col < count; col++) {
    const headerWidth = clean(headers[col] ?? "").length;
    let width = headerWidth;

    for (let row = 0; row < visibleRows; row++) {
      const value = clean(columns[col]?.[row] ?? "");
      width = Math.max(width, value.length);
    }

    natural[col] = width;
  }

  const maxWidth =
    options.maxWidth ??
    (process.stdout.columns == null ? 120 : process.stdout.columns);
  const available = Math.max(0, maxWidth - gap * (count - 1) - 1);
  const widths = fitWidths(
    natural,
    available,
    options.flex ?? [],
    options.noTruncate ?? [],
  );

  const header = headers
    .map((title, col) =>
      truncateMiddle(clean(title), widths[col] ?? 0).padEnd(widths[col] ?? 0),
    )
    .join("  ");

  process.stdout.write(`${theme.dim(header)}\n`);

  for (let row = 0; row < visibleRows; row++) {
    const cells: string[] = [];

    for (let col = 0; col < count; col++) {
      const width = widths[col] ?? 0;
      const source = clean(columns[col]?.[row] ?? "");
      const mode = options.truncate?.[col] ?? "middle";
      const value = options.noTruncate?.[col]
        ? source
        : truncate(source, width, mode);
      const padded = width > 0 ? value.padEnd(width) : value;
      const formatted = options.format?.[col]?.(padded, row, col) ?? padded;

      cells.push(formatted);
    }

    process.stdout.write(`${cells.join("  ")}\n`);
  }

  if (rows > visibleRows) {
    process.stdout.write(`${theme.dim("(...truncated)")}\n`);
  }
}

export function cols(
  rows: string[][],
  colorFns?: Array<(value: string) => string>,
): void {
  if (rows.length === 0) return;

  const widths = rows[0]!.map((_, col) => {
    let width = 0;

    for (const row of rows) {
      width = Math.max(width, clean(row[col] ?? "").length);
    }

    return width;
  });

  for (const row of rows) {
    const line = row
      .map((value, col) => {
        const padded = clean(value).padEnd(widths[col] ?? 0);
        return colorFns?.[col]?.(padded) ?? padded;
      })
      .join(" ");

    process.stdout.write(`${line}\n`);
  }
}

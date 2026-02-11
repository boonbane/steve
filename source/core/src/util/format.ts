export namespace Format {
  const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

  export function bytes(n: number): string {
    let i = 0;
    let size = Math.abs(n);
    while (size >= 1024 && i < UNITS.length - 1) {
      size /= 1024;
      i++;
    }
    if (i === 0) return `${n} B`;
    return `${size.toFixed(1)} ${UNITS[i]}`;
  }
}

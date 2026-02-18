import { ptr, type Pointer } from "bun:ffi";
import { IMsgNative } from "./ffi.ts";

export namespace Contacts {
  type Row = {
    input: string;
    name: string | null;
    found: boolean;
  };

  function marshal(handles: string[]) {
    const texts = handles.map((value) =>
      new TextEncoder().encode(`${value}\0`),
    );
    const ptrs = new BigUint64Array(texts.length);

    for (const [idx, item] of texts.entries()) {
      ptrs[idx] = BigInt(ptr(item));
    }

    return { texts, ptrs };
  }

  function read(result: Pointer): Row[] {
    const lib = IMsgNative.load();
    if (!lib) {
      return [];
    }

    const count = lib.symbols.imsg_contacts_result_count(result);
    const rows: Row[] = [];

    for (const idx of Array.from({ length: count }, (_, value) => value)) {
      rows.push({
        input:
          IMsgNative.text(
            lib.symbols.imsg_contacts_result_input(result, idx),
          ) ?? "",
        name: IMsgNative.text(
          lib.symbols.imsg_contacts_result_name(result, idx),
        ),
        found: lib.symbols.imsg_contacts_result_found(result, idx) === 1,
      });
    }

    return rows;
  }

  export function resolveNames(handles: string[]): Map<string, string> {
    if (handles.length === 0) {
      return new Map<string, string>();
    }

    const lib = IMsgNative.load();
    if (!lib) {
      return new Map<string, string>();
    }

    const auth = lib.symbols.imsg_contacts_auth_status();
    const status =
      auth === 0 ? lib.symbols.imsg_contacts_request_access() : auth;
    if (status !== 2) {
      return new Map<string, string>();
    }

    const input = marshal(handles);
    const out = new BigUint64Array(1);
    const code = lib.symbols.imsg_contacts_resolve(
      ptr(input.ptrs),
      handles.length,
      0,
      ptr(out),
    );

    if (code !== 0) {
      return new Map<string, string>();
    }

    const raw = Number(out[0] ?? 0n);
    if (!raw) {
      return new Map<string, string>();
    }

    const result = raw as Pointer;

    try {
      const rows = read(result);
      const map = new Map<string, string>();

      for (const row of rows) {
        if (!row.found || !row.name) {
          continue;
        }

        map.set(row.input, row.name);
      }

      return map;
    } finally {
      lib.symbols.imsg_contacts_result_free(result);
    }
  }
}

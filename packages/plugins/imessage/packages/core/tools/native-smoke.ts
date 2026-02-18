#!/usr/bin/env bun

import { ptr, type Pointer } from "bun:ffi";
import { IMsgNative } from "../ffi/ffi";

namespace NativeSmoke {
  type Row = {
    input: string | null;
    name: string | null;
    contactID: string | null;
    canonical: string | null;
    found: boolean;
    ambiguous: boolean;
    kind: number;
  };

  function marshal(handles: string[]) {
    const store = handles.map((value) =>
      new TextEncoder().encode(`${value}\0`),
    );
    const ptrs = new BigUint64Array(store.length);

    for (const [idx, item] of store.entries()) {
      ptrs[idx] = BigInt(ptr(item));
    }

    return { store, ptrs };
  }

  function read(result: Pointer): Row[] {
    const lib = IMsgNative.load();
    if (!lib) {
      return [];
    }

    const count = lib.symbols.imsg_contacts_result_count(result);
    const rows: Row[] = [];

    for (const idx of Array.from({ length: count }, (_, i) => i)) {
      rows.push({
        input: IMsgNative.text(
          lib.symbols.imsg_contacts_result_input(result, idx),
        ),
        name: IMsgNative.text(
          lib.symbols.imsg_contacts_result_name(result, idx),
        ),
        contactID: IMsgNative.text(
          lib.symbols.imsg_contacts_result_contact_id(result, idx),
        ),
        canonical: IMsgNative.text(
          lib.symbols.imsg_contacts_result_canonical(result, idx),
        ),
        found: lib.symbols.imsg_contacts_result_found(result, idx) === 1,
        ambiguous:
          lib.symbols.imsg_contacts_result_ambiguous(result, idx) === 1,
        kind: lib.symbols.imsg_contacts_result_match_kind(result, idx),
      });
    }

    return rows;
  }

  export function main() {
    const args = process.argv.slice(2);
    const request = args.includes("--request");
    const handlesArg = args.filter((value) => value !== "--request");
    const handles =
      handlesArg.length > 0
        ? handlesArg
        : ["+15555550123", "example@icloud.com"];
    const lib = IMsgNative.load();
    if (!lib) {
      process.stderr.write(`native dylib not found at ${IMsgNative.dylib}\n`);
      process.exit(1);
    }

    const auth = lib.symbols.imsg_contacts_auth_status();
    const status =
      request && auth === 0 ? lib.symbols.imsg_contacts_request_access() : auth;

    if (status !== 2) {
      process.stderr.write(`contacts not authorized (${status})\n`);
      if (!request && status === 0) {
        process.stderr.write(
          "rerun with --request to trigger the Contacts permission prompt\n",
        );
      }
      process.exit(1);
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
      process.stderr.write(`resolve failed (${code})\n`);
      process.exit(1);
    }

    const raw = Number(out[0] ?? 0n);
    if (!raw) {
      process.stderr.write("resolve returned null result\n");
      process.exit(1);
    }

    const result = raw as Pointer;
    const rows = read(result);
    lib.symbols.imsg_contacts_result_free(result);
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  }
}

NativeSmoke.main();

#!/usr/bin/env bun

import { CString, ptr } from "bun:ffi";
import { IMsgNative } from "../ffi/ffi";

namespace NativeSmoke {
  type Match = {
    input: string;
    name: string;
    contactId: string;
  };

  function marshal(handles: string[]) {
    const encoder = new TextEncoder();
    const store = handles.map((value) => encoder.encode(`${value}\0`));
    const ptrs = new BigUint64Array(store.length);

    for (const [idx, item] of store.entries()) {
      ptrs[idx] = BigInt(ptr(item));
    }

    return { store, ptrs };
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
    const outLen = new Uint32Array(1);
    const data = lib.symbols.imsg_contacts_resolve(
      ptr(input.ptrs),
      handles.length,
      ptr(outLen),
    );
    if (!data) {
      process.stderr.write("resolve returned no data\n");
      process.exit(1);
    }

    try {
      const length = outLen[0] ?? 0;
      const matches = JSON.parse(
        new CString(data, 0, length).toString(),
      ) as Match[];
      process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
    } finally {
      lib.symbols.imsg_contacts_resolve_free(data);
    }
  }
}

NativeSmoke.main();

import { ptr, type Pointer } from "bun:ffi";
import { IMsgNative } from "./ffi.ts";

export namespace Contacts {
  export type ContactInfo = {
    name: string;
    contactId: string | null;
  };

  type Row = {
    input: string;
    name: string | null;
    contactId: string | null;
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
        contactId: IMsgNative.text(
          lib.symbols.imsg_contacts_result_contact_id(result, idx),
        ),
        found: lib.symbols.imsg_contacts_result_found(result, idx) === 1,
      });
    }

    return rows;
  }

  export function resolve(handles: string[]): Map<string, ContactInfo> {
    if (handles.length === 0) {
      return new Map<string, ContactInfo>();
    }

    const lib = IMsgNative.load();
    if (!lib) {
      console.warn(
        "warning: native library not available — contact names will not be resolved.",
      );
      return new Map<string, ContactInfo>();
    }

    const auth = lib.symbols.imsg_contacts_auth_status();
    const status =
      auth === 0 ? lib.symbols.imsg_contacts_request_access() : auth;
    if (status !== 2) {
      const reason =
        status === 1
          ? "denied"
          : status === 3
            ? "restricted"
            : `unknown (status=${status})`;
      console.warn(
        `warning: Contacts access ${reason} — names will not be resolved. Check System Settings → Privacy & Security → Contacts.`,
      );
      return new Map<string, ContactInfo>();
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
      return new Map<string, ContactInfo>();
    }

    const raw = Number(out[0] ?? 0n);
    if (!raw) {
      return new Map<string, ContactInfo>();
    }

    const result = raw as Pointer;

    try {
      const rows = read(result);
      const map = new Map<string, ContactInfo>();

      for (const row of rows) {
        if (!row.found || !row.name) {
          continue;
        }

        map.set(row.input, { name: row.name, contactId: row.contactId });
      }

      return map;
    } finally {
      lib.symbols.imsg_contacts_result_free(result);
    }
  }

  export function image(
    identifier: string,
    maxPixel = 128,
  ): Uint8Array<ArrayBuffer> | null {
    if (identifier.length === 0) {
      return null;
    }

    const lib = IMsgNative.load();
    if (!lib) {
      return null;
    }

    const id = new TextEncoder().encode(`${identifier}\0`);
    const outLen = new Uint32Array(1);
    const data = lib.symbols.imsg_contact_image(ptr(id), maxPixel, ptr(outLen));
    if (!data) {
      return null;
    }

    try {
      return IMsgNative.bytes(data, outLen[0] ?? 0);
    } finally {
      lib.symbols.imsg_contact_image_free(data);
    }
  }
}

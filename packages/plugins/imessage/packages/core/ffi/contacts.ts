import { CString, ptr } from "bun:ffi";
import { IMsgNative } from "./ffi.ts";

export namespace Contacts {
  export type ContactInfo = {
    name: string;
    contactId: string | null;
  };

  type Match = {
    input: string;
    name: string;
    contactId: string;
  };

  export function normalize(value: string): string {
    let raw = value.trim();
    if (raw.length === 0) return "";

    if (raw.includes(";")) {
      raw = raw.split(";").pop()?.trim() ?? "";
      if (raw.length === 0) return "";
    }

    const lower = raw.toLowerCase();
    if (lower.startsWith("mailto:")) raw = raw.slice(7).trim();
    else if (lower.startsWith("tel:")) raw = raw.slice(4).trim();
    else if (lower.startsWith("sms:")) raw = raw.slice(4).trim();
    else if (lower.startsWith("imessage:")) raw = raw.slice(9).trim();

    if (raw.includes("@")) return raw.toLowerCase();

    const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
    return digits.length > 0 ? digits : raw;
  }

  function marshal(handles: string[]) {
    const encoder = new TextEncoder();
    const texts = handles.map((value) => encoder.encode(`${value}\0`));
    const ptrs = new BigUint64Array(texts.length);

    for (const [idx, item] of texts.entries()) {
      ptrs[idx] = BigInt(ptr(item));
    }

    return { texts, ptrs };
  }

  function authorize(lib: IMsgNative.Lib): boolean {
    const auth = lib.symbols.imsg_contacts_auth_status();
    const status =
      auth === 0 ? lib.symbols.imsg_contacts_request_access() : auth;
    if (status === 2) {
      return true;
    }

    const reason = status === 1 ? "denied" : `unknown (status=${status})`;
    console.warn(
      `warning: Contacts access ${reason} — names will not be resolved. Check System Settings → Privacy & Security → Contacts.`,
    );
    return false;
  }

  export function resolve(values: string[]): Map<string, ContactInfo> {
    const map = new Map<string, ContactInfo>();

    const handles = [
      ...new Set(values.map(normalize).filter((value) => value.length > 0)),
    ];
    if (handles.length === 0) {
      return map;
    }

    const lib = IMsgNative.load();
    if (!lib) {
      console.warn(
        "warning: native library not available — contact names will not be resolved.",
      );
      return map;
    }

    if (!authorize(lib)) {
      return map;
    }

    const input = marshal(handles);
    const outLen = new Uint32Array(1);
    const data = lib.symbols.imsg_contacts_resolve(
      ptr(input.ptrs),
      handles.length,
      ptr(outLen),
    );
    if (!data) {
      return map;
    }

    try {
      const length = outLen[0] ?? 0;
      if (length === 0) {
        return map;
      }

      const matches = JSON.parse(
        new CString(data, 0, length).toString(),
      ) as Match[];

      for (const match of matches) {
        if (!match.name) {
          continue;
        }

        map.set(match.input, {
          name: match.name,
          contactId: match.contactId ?? null,
        });
      }
    } finally {
      lib.symbols.imsg_contacts_resolve_free(data);
    }

    return map;
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

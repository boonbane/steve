import { Contacts } from "steve-plugin-imessage-core/ffi";

// Resolves phone/email handles to contact names via the native Contacts FFI.
// Results (hits and misses) are cached so each handle hits the FFI at most once.
export namespace Names {
  const cache = new Map<string, string | null>();

  // Reduce a raw handle to the canonical form the Contacts lookup expects:
  // strip URI schemes, lowercase emails, keep digits (with a leading +).
  export function normalize(value: string): string {
    const raw = value.trim();
    if (raw.length === 0) return "";

    const lower = raw.toLowerCase();
    if (lower.startsWith("mailto:")) return raw.slice(7).toLowerCase();
    if (lower.startsWith("tel:")) return raw.slice(4);
    if (lower.startsWith("sms:")) return raw.slice(4);
    if (lower.startsWith("imessage:")) return raw.slice(9);
    if (raw.includes("@")) return lower;

    // Phone-like: keep digits and a single leading "+".
    const out = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
    return out.length > 0 ? out : raw;
  }

  // Group chats use a synthetic "chatNNN" identifier — never a contact.
  export function isGroupId(identifier: string): boolean {
    return identifier.startsWith("chat");
  }

  export function resolve(values: string[]): Map<string, string> {
    const keys = [
      ...new Set(values.map(normalize).filter((value) => value.length > 0)),
    ];
    const missing = keys.filter((key) => !cache.has(key));

    if (missing.length > 0) {
      const found = Contacts.resolveNames(missing);
      for (const key of missing) cache.set(key, found.get(key) ?? null);
    }

    const out = new Map<string, string>();
    for (const key of keys) {
      const name = cache.get(key);
      if (name) out.set(key, name);
    }
    return out;
  }

  export function label(value: string, names: Map<string, string>): string | null {
    return names.get(normalize(value)) ?? null;
  }
}

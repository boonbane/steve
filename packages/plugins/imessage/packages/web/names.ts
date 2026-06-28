import { Contacts } from "steve-plugin-imessage-core/ffi";

export namespace Names {
  const cache = new Map<string, Contacts.ContactInfo | null>();

  // Group chats use a synthetic "chatNNN" identifier — never a contact.
  export function isGroupId(identifier: string): boolean {
    return identifier.startsWith("chat");
  }

  export function resolve(values: string[]): Map<string, Contacts.ContactInfo> {
    const keys = [
      ...new Set(
        values.map(Contacts.normalize).filter((value) => value.length > 0),
      ),
    ];
    const missing = keys.filter((key) => !cache.has(key));

    if (missing.length > 0) {
      const found = Contacts.resolve(missing);
      for (const key of missing) cache.set(key, found.get(key) ?? null);
    }

    const out = new Map<string, Contacts.ContactInfo>();
    for (const key of keys) {
      const info = cache.get(key);
      if (info) out.set(key, info);
    }
    return out;
  }

  export function label(
    value: string,
    names: Map<string, Contacts.ContactInfo>,
  ): string | null {
    return names.get(Contacts.normalize(value))?.name ?? null;
  }

  export function avatarId(
    value: string,
    names: Map<string, Contacts.ContactInfo>,
  ): string | null {
    return names.get(Contacts.normalize(value))?.contactId ?? null;
  }

  export function avatar(
    handle: string,
    maxPixel = 128,
  ): Uint8Array<ArrayBuffer> | null {
    const id = avatarId(handle, resolve([handle]));
    if (!id) return null;
    return Contacts.image(id, maxPixel);
  }
}

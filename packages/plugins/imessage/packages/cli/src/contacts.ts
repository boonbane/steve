import { Contacts } from "steve-plugin-imessage-core/ffi";

export namespace ContactLookup {
  export function resolve(values: string[]): Map<string, Contacts.ContactInfo> {
    return Contacts.resolve(values);
  }

  export function label(
    value: string,
    names: Map<string, Contacts.ContactInfo>,
  ): string {
    const key = Contacts.normalize(value);
    if (key.length === 0) {
      return value;
    }

    return names.get(key)?.name ?? key;
  }
}

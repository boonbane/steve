import { Contacts } from "steve-plugin-imessage-core/ffi";

export namespace ContactLookup {
  function candidate(value: string): string {
    const raw = value.trim();
    if (raw.length === 0) {
      return "";
    }

    if (raw.includes(";")) {
      const parts = raw.split(";");
      return parts[parts.length - 1]?.trim() ?? "";
    }

    return raw;
  }

  export function normalize(value: string): string {
    const item = candidate(value);
    const lower = item.toLowerCase();

    if (lower.startsWith("mailto:")) {
      return item.slice(7).toLowerCase();
    }

    if (lower.startsWith("tel:")) {
      return item.slice(4);
    }

    if (lower.startsWith("sms:")) {
      return item.slice(4);
    }

    if (lower.startsWith("imessage:")) {
      return item.slice(9);
    }

    if (item.includes("@")) {
      return item.toLowerCase();
    }

    let out = "";

    for (const ch of item) {
      if (ch >= "0" && ch <= "9") {
        out += ch;
        continue;
      }

      if (ch === "+" && out.length === 0) {
        out += ch;
      }
    }

    if (out.length > 0) {
      return out;
    }

    return item;
  }

  export function resolve(values: string[]): Map<string, string> {
    const keys = Array.from(
      new Set(
        values
          .map((value) => normalize(value))
          .filter((value) => value.length > 0),
      ),
    );

    return Contacts.resolveNames(keys);
  }

  export function label(value: string, names: Map<string, string>): string {
    const key = normalize(value);
    if (key.length === 0) {
      return value;
    }

    return names.get(key) ?? key;
  }
}

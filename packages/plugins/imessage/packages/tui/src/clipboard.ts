import fs from "node:fs";
import path from "node:path";
import type { OutgoingImage } from "./api.ts";

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

export function readClipboardImage(): OutgoingImage | null {
  if (process.platform === "darwin") return macFile() ?? macPng();
  return linuxFile() ?? linuxPng();
}

function run(cmd: string[]): Uint8Array | null {
  try {
    const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
    if (proc.exitCode !== 0 || proc.stdout.length === 0) return null;
    return new Uint8Array(proc.stdout);
  } catch {
    return null; // tool not installed
  }
}

function runText(cmd: string[]): string | null {
  const out = run(cmd);
  return out ? new TextDecoder().decode(out).trim() : null;
}

function fromFile(filePath: string): OutgoingImage | null {
  const mime = EXT_MIME[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  try {
    return {
      data: fs.readFileSync(filePath),
      mime,
      name: path.basename(filePath),
    };
  } catch {
    return null;
  }
}

// One clipboard target, via whichever tool matches the session type.
function linuxTarget(type: string): Uint8Array | null {
  if (process.env.WAYLAND_DISPLAY) {
    return run(["wl-paste", "--no-newline", "--type", type]);
  }
  if (process.env.DISPLAY) {
    return run(["xclip", "-selection", "clipboard", "-t", type, "-o"]);
  }
  return null;
}

function linuxFile(): OutgoingImage | null {
  const uris = linuxTarget("text/uri-list");
  if (!uris) return null;
  for (const line of new TextDecoder().decode(uris).split(/\r?\n/)) {
    if (!line.startsWith("file://")) continue;
    try {
      const image = fromFile(decodeURIComponent(new URL(line).pathname));
      if (image) return image;
    } catch {
      // Malformed URI; try the next line.
    }
  }
  return null;
}

function linuxPng(): OutgoingImage | null {
  const data = linuxTarget("image/png");
  return data ? { data, mime: "image/png", name: "clipboard.png" } : null;
}

function macFile(): OutgoingImage | null {
  const posixPath = runText([
    "osascript",
    "-e",
    "POSIX path of (the clipboard as «class furl»)",
  ]);
  return posixPath ? fromFile(posixPath) : null;
}

function macPng(): OutgoingImage | null {
  // osascript prints binary clipboard data as «data PNGf6873AB…» (hex).
  const out = runText(["osascript", "-e", "get the clipboard as «class PNGf»"]);
  const hex = out?.match(/«data PNGf([0-9A-Fa-f]+)»/)?.[1];
  if (!hex) return null;
  return {
    data: Buffer.from(hex, "hex"),
    mime: "image/png",
    name: "clipboard.png",
  };
}

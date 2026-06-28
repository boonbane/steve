import { CString, FFIType, dlopen, toArrayBuffer, type Pointer } from "bun:ffi";
import path from "path";

export namespace IMsgNative {
  export const dylib = path.join(
    import.meta.dir,
    "..",
    ".cache",
    "store",
    "lib",
    "libimsg.dylib",
  );

  const symbols = {
    imsg_contacts_auth_status: {
      args: [],
      returns: FFIType.i32,
    },
    imsg_contacts_request_access: {
      args: [],
      returns: FFIType.i32,
    },
    imsg_contacts_resolve: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    imsg_contacts_resolve_free: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    imsg_contact_image: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    imsg_contact_image_free: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
  } as const;

  export type Lib = ReturnType<typeof dlopen<typeof symbols>>;

  let loaded: Lib | null | undefined;

  export function load() {
    if (loaded !== undefined) {
      return loaded;
    }

    try {
      loaded = dlopen(dylib, symbols);
    } catch (err) {
      console.warn(`warning: failed to load native library at ${dylib}:`, err);
      loaded = null;
    }

    return loaded;
  }

  export function text(value: Pointer | null): string | null {
    if (!value) {
      return null;
    }

    return new CString(value).toString();
  }

  export function bytes(
    value: Pointer | null,
    length: number,
  ): Uint8Array<ArrayBuffer> | null {
    if (!value || length <= 0) {
      return null;
    }

    return new Uint8Array(toArrayBuffer(value, 0, length).slice(0));
  }
}

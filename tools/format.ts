import path from "path";
import { $ } from "bun";

export namespace Format {
  const paths = {
    root: path.join(import.meta.dir, ".."),
    child: (relative: string) => path.join(paths.root, relative),
  };

  export const clang = async () => {
    const glob = new Bun.Glob("plugins/imessage/src/**/*.{c,h}");
    const files = [] as string[];

    for (const file of glob.scanSync({ cwd: paths.root, onlyFiles: true })) {
      files.push(paths.child(file));
    }

    if (files.length === 0) {
      return;
    }

    await $`clang-format -i --style=file ${files}`;
  };

  export const swift = async () => {
    await $`swift format --configuration ${paths.child(".swift-format")} --in-place --recursive ${paths.child("packages/ios")}`;
  };

  export const ts = async () => {
    await $`prettier --write ${paths.child("packages/**/*.{ts,tsx}")} ${paths.child("*.{json,md}")}`;
  };
}

if (import.meta.main) {
  await Format.clang();
  await Format.swift();
  await Format.ts();
}

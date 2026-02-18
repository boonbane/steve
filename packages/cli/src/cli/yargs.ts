import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { type Theme, defaultTheme } from "./theme.ts";

export type OptionDef = {
  alias?: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
};

export type Options = Record<string, OptionDef>;

export type PositionalDef = {
  type: "string" | "number";
  description: string;
  required?: boolean;
  default?: unknown;
};

export type Positionals = Record<string, PositionalDef>;

export type CommandDef = {
  description: string;
  summary?: string;
  hidden?: boolean;
  positionals?: Positionals;
  options?: Options;
  commands?: Record<string, CommandDef>;
  handler?: (argv: any) => void | Promise<void>;
};

export type CliDef = {
  name: string;
  description: string;
  options?: Options;
  commands: Record<string, CommandDef>;
};

function cols(rows: string[][], fns?: ((s: string) => string)[]): void {
  if (rows.length === 0) return;
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((r) => r[i]!.length)),
  );
  for (const row of rows) {
    const line = row.map((c, i) => {
      const padded = c.padEnd(widths[i]!);
      return fns?.[i] ? fns[i]!(padded) : padded;
    });
    console.log(line.join(" "));
  }
}

function usage(def: CommandDef | CliDef, path: string[], t: Theme): string {
  const parts: string[] = [];
  const last = path.length - 1;
  for (let i = 0; i < path.length; i++) {
    parts.push(i === last ? t.command(path[i]!) : path[i]!);
  }

  if ("positionals" in def && def.positionals) {
    for (const [k, v] of Object.entries(def.positionals)) {
      const name = t.arg(`$${k}`);
      parts.push(v.required ? name : `[${name}]`);
    }
  }

  if (def.options && Object.keys(def.options).length > 0) {
    parts.push(t.dim("[options]"));
  }

  if (
    "commands" in def &&
    def.commands &&
    Object.keys(def.commands).length > 0
  ) {
    parts.push(t.arg("$command"));
  }

  return parts.join(" ");
}

export function help(
  def: CommandDef | CliDef,
  name: string,
  path: string[] = [],
  t: Theme = defaultTheme,
): void {
  let prev = false;

  if (def.description) {
    console.log(t.description(def.description));
    prev = true;
  }

  if (prev) console.log("");
  console.log(t.header("usage:"));
  console.log(`  ${usage(def, [name, ...path], t)}`);
  prev = true;

  const pos = "positionals" in def ? def.positionals : undefined;
  if (pos && Object.keys(pos).length > 0) {
    if (prev) console.log("");
    console.log(t.header("arguments"));
    prev = true;

    const rows: string[][] = [];
    for (const [k, v] of Object.entries(pos)) {
      let desc = v.description;
      if (v.default !== undefined)
        desc += ` ${t.dim(`(default: ${v.default})`)}`;
      if (v.required) desc += ` ${t.dim("(required)")}`;
      rows.push([`  ${k}`, v.type, desc]);
    }
    cols(rows, [t.arg, t.type, t.description]);
  }

  const opts: Record<string, OptionDef> = {
    ...(def.options ?? {}),
    help: { alias: "h", type: "boolean", description: "Show help" },
  };

  if (Object.keys(opts).length > 0) {
    if (prev) console.log("");
    console.log(t.header("options"));
    prev = true;

    const rows: string[][] = [];
    for (const [k, v] of Object.entries(opts)) {
      const short = v.alias ? `-${v.alias}, ` : "    ";
      let desc = v.description;
      if (v.default !== undefined && v.type !== "boolean") {
        desc += ` ${t.dim(`(default: ${v.default})`)}`;
      }
      rows.push([`  ${short}--${k}`, v.type, desc]);
    }
    cols(rows, [t.option, t.type, t.description]);
  }

  const cmds = "commands" in def ? def.commands : undefined;
  if (cmds && Object.keys(cmds).length > 0) {
    if (prev) console.log("");
    console.log(t.header("commands"));

    const rows: string[][] = [];
    for (const [k, v] of Object.entries(cmds)) {
      if (v.hidden) continue;
      const args = v.positionals ? Object.keys(v.positionals).join(" ") : "";
      rows.push([`  ${k}`, args, v.summary ?? v.description]);
    }
    cols(rows, [t.command, t.arg, t.description]);
  }
}

function fail(def: CommandDef | CliDef, name: string, path: string[] = []) {
  return (msg: string | null): void => {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      help(def, name, path);
      process.exit(0);
    }
    if (
      msg?.includes("You must specify") ||
      msg?.includes("Not enough non-option arguments")
    ) {
      help(def, name, path);
      process.exit(1);
    }
    console.error(msg ?? "Unknown error");
    process.exit(1);
  };
}

function check(def: CommandDef | CliDef, name: string, path: string[] = []) {
  return (argv: any): boolean => {
    if (argv.help && argv._.length === path.length) {
      help(def, name, path);
      process.exit(0);
    }
    return true;
  };
}

function configure(
  y: any,
  def: CommandDef | CliDef,
  root: string,
  path: string[],
): void {
  if ("positionals" in def && def.positionals) {
    for (const [k, v] of Object.entries(def.positionals)) {
      y.positional(k, {
        type: v.type,
        describe: v.description,
        demandOption: v.required,
        default: v.default,
      });
    }
  }

  if (def.options) {
    for (const [k, v] of Object.entries(def.options)) {
      y.option(k, {
        alias: v.alias,
        type: v.type,
        describe: v.description,
        demandOption: v.required,
        default: v.default,
      });
    }
  }

  if ("commands" in def && def.commands) {
    for (const [k, v] of Object.entries(def.commands)) {
      command(y, k, v, root, path);
    }
    y.demandCommand(1, "You must specify a command");
  }

  y.help(false)
    .option("help", { alias: "h", type: "boolean", describe: "Show help" })
    .check(check(def, root, path))
    .fail(fail(def, root, path));
}

function command(
  y: any,
  name: string,
  def: CommandDef,
  root: string,
  path: string[],
): void {
  let cmd = name;
  if (def.positionals) {
    for (const [k, v] of Object.entries(def.positionals)) {
      cmd += v.required ? ` <${k}>` : ` [${k}]`;
    }
  }
  y.command(
    cmd,
    def.description,
    (yargs: any) => configure(yargs, def, root, [...path, name]),
    def.handler,
  );
}

export function build(def: CliDef): any {
  const y = yargs(hideBin(process.argv)).scriptName(def.name);
  configure(y, def, def.name, []);
  y.strict();
  return y;
}

import path from "path";
import pino from "pino";
import type { Opencode as OpencodeModule } from "./opencode.ts";
import { Database } from "bun:sqlite";
import type { Context as WhisperContext } from "node-whisper-cpp";
import { Config } from "./config.ts";
import { DB } from "./db.ts";
import { Opencode } from "./opencode.ts";
import { Skill } from "./skill.ts";
import { Task } from "./task.ts";
import { Wav } from "./wav.ts";

export namespace Context {
  export type Opencode = OpencodeModule.Resolved;

  export interface Dirs {
    logs: string;
    log: (name: string) => string;
    data: string;
    db: string;
    models: string;
    model: (name: string) => string;
    skills: string;
    tasks: string;
    prompts: string;
    prompt: (name: string) => string;
  }

  interface Store {
    config?: Config.Resolved;
    dirs?: Dirs;
    logger?: pino.Logger;
    skills?: Skill.List;
    tasks?: Task.List;
    db?: Promise<Database>;
    opencode?: Promise<Opencode>;
    whisper?: WhisperContext;
  }

  let store: Store = {};

  async function close(value: Store) {
    const tasks: Promise<unknown>[] = [];

    if (value.opencode) {
      tasks.push(
        value.opencode
          .then((runtime) => runtime.close())
          .catch(() => undefined),
      );
    }
    if (value.whisper) {
      value.whisper.free();
    }
    if (value.db) {
      tasks.push(DB.close(value.db).catch(() => undefined));
    }

    await Promise.all(tasks);
  }

  export function config(): Config.Resolved {
    if (store.config) return store.config;
    store.config = Config.load();
    return store.config;
  }

  export function dirs(): Dirs {
    if (store.dirs) return store.dirs;

    const c = config();
    store.dirs = {
      data: c.data,
      db: path.join(c.data, "steve.db"),
      logs: path.join(c.data, "logs"),
      log: (name: string) => path.join(store.dirs!.logs, name),
      models: path.join(c.data, "models"),
      model: (name) => path.join(store.dirs!.models, name),
      skills: path.join(c.dir, "skills"),
      tasks: path.join(c.dir, "tasks"),
      prompts: path.join(c.dir, "prompts"),
      prompt: (name) => path.join(store.dirs!.prompts, `${name}.md`),
    };
    return store.dirs;
  }

  export function logger(): pino.Logger {
    if (!store.logger) {
      const transport = pino.transport({
        targets: [
          {
            target: "pino-roll",
            options: {
              file: dirs().log("steve.log"),
              frequency: "daily",
              mkdir: true,
            },
          },
          {
            target: "pino-pretty",
            options: {
              colorize: true,
            },
          },
        ],
      });

      store.logger = pino(transport);
    }

    return store.logger;
  }

  export function skills(): Skill.List {
    if (store.skills) return store.skills;
    store.skills = Skill.load();
    return store.skills;
  }

  export function tasks(): Task.List {
    if (store.tasks) return store.tasks;
    store.tasks = Task.load();
    return store.tasks;
  }

  export function preload() {
    config();
    dirs();
    skills();
    tasks();
    opencode();
  }

  export async function db(): Promise<Database> {
    if (store.db) return store.db;
    store.db = DB.open(dirs().db);
    return store.db;
  }

  export async function opencode(): Promise<Opencode> {
    if (store.opencode) return store.opencode;
    const result = Opencode.load();
    store.opencode = result;
    void result.catch(() => {
      if (store.opencode === result) {
        store.opencode = undefined;
      }
    });
    return result;
  }

  const WHISPER_MODEL = "ggml-base.en.bin";
  export function whisper(): WhisperContext {
    if (store.whisper) return store.whisper;
    store.whisper = Wav.whisper(dirs().model(WHISPER_MODEL));
    return store.whisper;
  }

  export async function reset() {
    const value = store;
    store = {};
    await close(value);
  }

  export function override(values: Partial<Store>) {
    Object.assign(store, values);
  }

  export async function setDir(dir: string) {
    const value = store;
    store = {
      ...store,
      config: { dir, data: dir },
      dirs: undefined,
      skills: undefined,
      tasks: undefined,
      db: undefined,
      opencode: undefined,
      whisper: undefined,
    };
    await close(value);
  }
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_, k) {
    const v = Context.logger()[k as keyof pino.Logger];
    if (typeof v === "function") return v.bind(Context.logger());
    return v;
  },
});

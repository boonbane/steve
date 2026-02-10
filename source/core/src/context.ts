import path from "path";
import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { Database } from "bun:sqlite";
import type { Context as WhisperContext } from "node-whisper-cpp";
import { Config } from "./config.ts";
import { DB } from "./db.ts";
import { Skill } from "./skill.ts";
import { Task } from "./task.ts";
import { Wav } from "./wav.ts";

export namespace Context {
  export interface Opencode {
    client: OpencodeClient;
    url: string;
    close: () => void;
  }

  export interface Dirs {
    storage: string;
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
    skills?: Skill.List;
    tasks?: Task.List;
    db?: Promise<Database>;
    opencode?: Promise<Opencode>;
    whisper?: Promise<WhisperContext>;
  }

  let store: Store = {};

  export async function config(): Promise<Config.Resolved> {
    if (store.config) return store.config;
    store.config = await Config.load();
    return store.config;
  }

  export async function dirs(): Promise<Dirs> {
    if (store.dirs) return store.dirs;
    const cfg = await config();
    const data = cfg.data;
    const storage = path.join(cfg.dir, "storage");
    const models = path.join(cfg.dir, "models");
    const prompts = path.join(cfg.dir, "prompts");
    store.dirs = {
      data,
      db: path.join(data, "steve.db"),
      storage,
      models,
      model: (name) => path.join(models, name),
      skills: path.join(cfg.dir, "skills"),
      tasks: path.join(cfg.dir, "tasks"),
      prompts,
      prompt: (name) => path.join(prompts, `${name}.md`),
    };
    return store.dirs;
  }

  export async function skills(): Promise<Skill.List> {
    if (store.skills) return store.skills;
    store.skills = await Skill.load();
    return store.skills;
  }

  export async function tasks(): Promise<Task.List> {
    if (store.tasks) return store.tasks;
    store.tasks = await Task.load();
    return store.tasks;
  }

  export async function db(): Promise<Database> {
    if (store.db) return store.db;
    store.db = dirs().then((dirs) => DB.open(dirs.db));
    return store.db;
  }

  export async function opencode(): Promise<Opencode> {
    if (store.opencode) return store.opencode;
    store.opencode = createOpencode().then((runtime) => {
      return {
        client: runtime.client,
        url: runtime.server.url,
        close: runtime.server.close,
      };
    });
    return store.opencode;
  }

  export async function whisper(): Promise<WhisperContext> {
    if (store.whisper) return store.whisper;
    store.whisper = dirs().then((dirs) =>
      Wav.whisper(dirs.model("ggml-base.en.bin")),
    );
    return store.whisper;
  }

  export function reset() {
    const opencode = store.opencode;
    const whisper = store.whisper;
    const db = store.db;
    store = {};
    if (opencode) void opencode.then((runtime) => runtime.close());
    if (whisper) void whisper.then((ctx) => ctx.free());
    if (db) void DB.close(db);
  }

  export function override(values: Partial<Store>) {
    Object.assign(store, values);
  }

  export function setDir(dir: string) {
    store = {
      ...store,
      config: { dir, data: dir },
      dirs: undefined,
      skills: undefined,
      tasks: undefined,
      db: undefined,
    };
  }
}

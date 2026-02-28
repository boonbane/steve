# Overview

This is an agent framework for accessing an LLM assistant from your iPhone. You provide the inference (Anthropic, OpenAI, Google, etc.), and we provide a server relay, an iOS app, and a ton of integrations.

# Files

Bun monorepo with an iOS app.

- `source`: Bun monorepo packages
  - `tools/`: dev tooling, always written with Bun + TS
  - `ios/`: iPhone app
  - `server/`: HTTP API through which you interact with the assistant. Hono.
  - `core/`: Domain logic
    - `core/src/db`: SQLite database that stores all persistent runtime data
    - `core/src/prompts`: Builtin prompt templates
    - `core/src/skill.ts`: LLM skills (i.e. instructions + references + metadata)
    - `core/src/task.ts`: A high-level task to be invoked by the user; provides instructions, a set of skills, whitelisted directories

# Commands

- `turbo typecheck`

# Rules

- Always use native Bun APIs where applicable
- Always export and import a single, top-level namespace instead of loose symbols
- Always use the `tmux` skill when you need to run e.g. a server and a client simultaneously; never try to time them with `sleep` or `timeout`
- Always `import path from "path"` instead of `import { whatever } from "path"`; same for `fs` and other Bun modules
- Always use `db.run` from `Bun.sqlite`, not `db.exec`
- Prefer single word variable names
- Prefer small, local utilities to reduce duplication and boilerplate
- Avoid using functions to organize code; instead, prefer to keep code in one function unless you need reuse
- Avoid `try` and `catch`; instead, prefer to return error codes
- Avoid `else` statements
- Avoid using `any`
- Avoid `let` statements
- Never write scripts with loose code; always put `main()` into a function and invoke it
- Never `console.log`; prefer `consola`
- Never use `/tmp`; prefer `.cache/scratch`. Out-of-tree directory access forces manual approval, `.cache/scratch` lets you work autonomously
- Never write utilities as Bash scripts; always use TypeScript + Bun
- Never wrap `await foo()` in parentheses in an if statement

# Skills

- `doc/agents/ios.md`: Always read before writing any iOS code

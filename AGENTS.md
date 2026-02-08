# Overview
This is an agent framework for accessing an LLM assistant from your iPhone. You provide the inference (Anthropic, OpenAI, Google, etc.), and we provide a server relay, an iOS app, and a ton of integrations.

# Files
Bun monorepo with an iOS app.

- `source`: source code, broken into packages
- `source/tools`: dev tooling, always written with Bun + TS
- `source/ios`: iPhone app
- `source/server`: HTTP API through which everything is routed.

# Rules
- Always use native Bun APIs where applicable
- Always export and import a single, top-level namespace instead of loose symbols
- Prefer single word variable names
- Avoid using functions to organize code; instead, prefer to keep code in one function unless you need reuse
- Avoid `try` and `catch`; instead, prefer to return error codes
- Avoid `else` statements
- Avoid using `any`
- Avoid `let` statements
- Never write scripts with loose code; always put `main()` into a function and invoke it
- Never `console.log`; prefer `consola`

# Skills
- `doc/agents/ios.md`: Always read before writing any iOS code

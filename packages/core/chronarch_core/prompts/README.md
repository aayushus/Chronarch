# Prompt files

Every string shown to an AI model lives here — one file per prompt, plain
Markdown, editable without touching code. **Edits apply on the next request**
(files are re-read when modified; no rebuild or restart needed).

- `copilot/system.md` — the copilot system prompt. `{timezone}`, `{now}`,
  `{view_ctx}`, `{hours_ctx}` are filled per request; any other `{brace}`
  raises KeyError on purpose (typos fail fast, never leak to the model).
- `copilot/tools/<name>.md` — one-line description for each copilot function.
  Parameter help stays in `apps/api/app/routers/copilot_router.py` next to
  the JSON schemas (structure, not prose).
- `mcp/tools/<name>.md` — description shown to external agents
  (Claude/ChatGPT read these when discovering tools). Keep WRITE vs
  DESTRUCTIVE tiers explicit here.

Rules: plain text/Markdown only, no secrets, no `{braces}` except the four
system placeholders. `test_prompts.py` enforces that every registered tool
has exactly one file — add the file when you add a tool.

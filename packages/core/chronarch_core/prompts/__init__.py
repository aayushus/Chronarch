"""File-backed LLM prompts (system prompt + tool descriptions).

Every string shown to a model lives here as an individual Markdown file so
it can be edited without touching code. Files are re-read when modified
(mtime cache), so edits apply on the next request — no rebuild needed,
though containers must see the file (they do: packages/ is copied whole).
"""

from __future__ import annotations

import os
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent

_cache: dict[str, tuple[float, str]] = {}


def load_prompt(relative_path: str) -> str:
    """Load a prompt file (e.g. "copilot/system.md"), stripped.

    Raises FileNotFoundError for missing files — callers wire these at
    import time on purpose, so a deleted/renamed prompt fails loudly at
    startup instead of silently changing model behavior.
    """
    path = PROMPTS_DIR / relative_path
    mtime = os.path.getmtime(path)
    cached = _cache.get(relative_path)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    text = path.read_text(encoding="utf-8").strip() + "\n"
    _cache[relative_path] = (mtime, text)
    return text


def tool_description(surface: str, tool_name: str) -> str:
    """One-line description for a tool on a surface ("copilot" or "mcp")."""
    return load_prompt(f"{surface}/tools/{tool_name}.md").strip()


def render_system_prompt(*, now: str, timezone: str, view_ctx: str = "", hours_ctx: str = "") -> str:
    """Render the copilot system prompt. Unknown {placeholders} raise KeyError
    so a typo in the .md file fails fast instead of leaking braces."""
    template = load_prompt("copilot/system.md")
    return template.format(now=now, timezone=timezone, view_ctx=view_ctx, hours_ctx=hours_ctx)

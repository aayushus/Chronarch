"""Prompt-file integrity: every registered tool has exactly one file, the
system template renders, and loader failures stay loud."""

import pytest

from chronarch_core.prompts import load_prompt, render_system_prompt, tool_description


def test_system_prompt_renders_all_placeholders():
    out = render_system_prompt(now="2026-09-13T09:00:00-07:00", timezone="America/Los_Angeles",
                               view_ctx=" VIEW", hours_ctx=" HOURS")
    assert "America/Los_Angeles" in out
    assert "2026-09-13T09:00:00-07:00" in out
    assert " VIEW" in out and " HOURS" in out
    assert "{" not in out and "}" not in out


def test_system_prompt_empty_contexts():
    out = render_system_prompt(now="x", timezone="UTC")
    assert "{" not in out and "}" not in out


def _source(*parts: str):
    """Locate a repo source file from either a dev checkout or a service
    image (which only carries its own app tree). Skips when absent so the
    same suite runs in every image."""
    import chronarch_core
    from pathlib import Path

    pkg_root = Path(chronarch_core.__file__).resolve().parents[3]
    cwd = Path.cwd()
    candidates = [pkg_root, Path("/srv")] + [cwd] + list(cwd.parents)
    seen = []
    for base in candidates:
        p = base.joinpath(*parts)
        seen.append(str(p))
        if p.exists():
            return p
    pytest.skip(f"source not present in this image: {'/'.join(parts)}")


def test_copilot_tool_files_cover_schema():
    import ast

    tree = ast.parse(_source("apps", "api", "app", "routers", "copilot_router.py").read_text())
    names = []
    for n in ast.walk(tree):
        if not isinstance(n, ast.Dict):
            continue
        keys = [k.value for k in n.keys if isinstance(k, ast.Constant)]
        if "name" in keys and "description" in keys:
            v = n.values[keys.index("name")]
            if isinstance(v, ast.Constant):
                names.append(v.value)
    # Every copilot tool must resolve to a prompt file.
    assert len(names) == 22, names
    assert "move_event_between_calendars" in names
    for name in names:
        text = tool_description("copilot", name)
        assert len(text) > 20, name


def test_mcp_tool_files_cover_server():
    import ast

    tree = ast.parse(_source("apps", "mcp", "app", "server.py").read_text())
    funcs = [n.name for n in ast.walk(tree)
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
             and any(getattr(d, "func", None) and getattr(d.func, "value", None) is not None
                     for d in n.decorator_list)]
    # Functions decorated with @mcp.tool(...) must each have a prompt file.
    assert len(funcs) >= 15
    for name in funcs:
        text = tool_description("mcp", name)
        assert len(text) > 10, name


def test_copilot_booking_schemas_expose_timezone():
    """Silent-correctness-bug guard: create_event must accept an explicit
    IANA timezone so the model never hand-computes UTC offsets."""
    import ast

    tree = ast.parse(_source("apps", "api", "app", "routers", "copilot_router.py").read_text())
    schemas = {}
    for n in ast.walk(tree):
        if not isinstance(n, ast.Dict):
            continue
        keys = [k.value for k in n.keys if isinstance(k, ast.Constant)]
        if "name" in keys and "parameters" in keys:
            idx = keys.index("name")
            v = n.values[idx]
            if isinstance(v, ast.Constant):
                schemas[v.value] = n
    assert "create_event" in schemas
    assert "timezone" in ast.dump(schemas["create_event"])


def test_copilot_update_event_has_no_time_fields():
    """Overlap guard: update_event must not accept start/end/timezone — all
    time changes route through move_event so the model never chooses
    between two tools for a plain reschedule."""
    import ast

    tree = ast.parse(_source("apps", "api", "app", "routers", "copilot_router.py").read_text())
    for n in ast.walk(tree):
        if not isinstance(n, ast.Dict):
            continue
        keys = [k.value for k in n.keys if isinstance(k, ast.Constant)]
        if "name" in keys and "parameters" in keys:
            v = n.values[keys.index("name")]
            if isinstance(v, ast.Constant) and v.value == "update_event":
                text = ast.dump(n)
                assert "'start'" not in text and "'end'" not in text and "timezone" not in text
                assert "all_day" in text
                return
    raise AssertionError("update_event schema not found")


def test_missing_prompt_fails_loud():
    with pytest.raises(FileNotFoundError):
        load_prompt("copilot/tools/no_such_tool.md")


def test_no_secrets_in_prompts():
    from pathlib import Path

    for path in (Path(__file__).parent.parent / "chronarch_core" / "prompts").rglob("*.md"):
        if path.name == "README.md":
            continue
        text = path.read_text().lower()
        assert "sk-or-" not in text and "gsk_" not in text and "AIza" not in text, path

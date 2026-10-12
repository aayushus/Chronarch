"""Automated verification suite for AI Governance & Risk Management.

Ensures compliance with:
- NIST AI Risk Management Framework 1.0 (GOVERN, MAP, MEASURE, MANAGE)
- ISO/IEC 42001:2023 (Artificial Intelligence Management System)
"""

import pytest
from pathlib import Path

from chronarch_core.ai_config import DEFAULTS
from app.routers.copilot_router import COPILOT_TOOLS


def test_ai_governance_documentation_exists():
    """Verify ISO 42001 & NIST AI RMF required documentation artifacts exist."""
    root = Path(__file__).resolve().parent.parent.parent.parent
    gov_doc = root / "docs" / "AI_GOVERNANCE.md"
    risk_doc = root / "docs" / "AI_RISK_MANAGEMENT.md"

    assert gov_doc.exists(), "docs/AI_GOVERNANCE.md must exist for ISO 42001 / NIST compliance"
    assert risk_doc.exists(), "docs/AI_RISK_MANAGEMENT.md must exist for ISO 42001 / NIST compliance"

    gov_content = gov_doc.read_text()
    assert "ISO/IEC 42001:2023" in gov_content
    assert "NIST AI Risk Management Framework 1.0" in gov_content
    assert "Zero-Data-Retention" in gov_content

    risk_content = risk_doc.read_text()
    assert "Human-in-the-Loop Oversight Protocol" in risk_content
    assert "AIR-01" in risk_content


def test_ai_governance_multi_tier_fallback_configured():
    """Verify NIST MANAGE / ISO A.6 multi-model fallback resiliency configuration."""
    # Ensure primary, fallback, and emergency model defaults are specified and non-empty
    assert "primary_model" in DEFAULTS and bool(DEFAULTS["primary_model"])
    assert "fallback_model" in DEFAULTS and bool(DEFAULTS["fallback_model"])
    assert "emergency_model" in DEFAULTS and bool(DEFAULTS["emergency_model"])
    assert "timeout_seconds" in DEFAULTS and DEFAULTS["timeout_seconds"] > 0


def test_ai_governance_human_in_the_loop_tools():
    """Verify ISO 42001 Annex A.7 / NIST MANAGE 2: Confirmation & reversibility tools."""
    tool_map = {t["function"]["name"]: t["function"] for t in COPILOT_TOOLS if "function" in t}

    # Two-stage commit requirement: destructive tools must require confirmation parameter
    assert "delete_event" in tool_map, "delete_event tool must exist"
    delete_params = tool_map["delete_event"]["parameters"]["properties"]
    assert "confirmed" in delete_params, "delete_event must enforce a confirmed boolean flag for human oversight"

    # Action reversibility requirement
    assert "undo_last_copilot_action" in tool_map, "undo_last_copilot_action must be exposed for reversibility"

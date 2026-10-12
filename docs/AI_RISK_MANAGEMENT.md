# Chronarch AI Risk Assessment & Management Policy
**Framework Alignment**: NIST AI RMF 1.0 (MAP & MANAGE) & ISO/IEC 42001:2023 (Clause 6 & Annex A.6, A.7)

---

## 1. Risk Assessment Methodology (NIST MAP / ISO 42001 Clause 6.1)

AI risks are evaluated across two dimensions:
- **Likelihood**: Unlikely (1), Possible (2), Probable (3).
- **Severity**: Minor (1), Moderate (2), Critical (3).
- **Risk Score** = Likelihood × Severity (1-9). Scores ≥ 4 require mandatory architectural mitigations.

---

## 2. AI Risk Register

| Risk ID | Hazard / Risk Description | Severity | Likelihood | Inherent Risk | Implemented Control / Mitigation | Residual Risk |
|---|---|---|---|---|---|---|
| **AIR-01** | **Direct Prompt Injection**: User manipulates copilot to execute unauthorized actions or disclose system instructions. | Critical (3) | Probable (3) | High (9) | • Hardened system instructions with explicit refusal directives.<br>• Two-stage human confirmation for all mutations.<br>• Tool privilege scoping. | Low (2) |
| **AIR-02** | **Indirect Prompt Injection**: Malicious invite summary/description attempts to hijack copilot context. | Critical (3) | Possible (2) | High (6) | • External event payloads wrapped in inert `<external_event_data>` delimiters.<br>• Instructions to treat external content strictly as untrusted data. | Low (2) |
| **AIR-03** | **Hallucinated Scheduling**: Model invents non-existent free slots or miscalculates overlaps. | Moderate (2) | Probable (3) | High (6) | • Availability engine does deterministic slot computation via `chronarch_core.availability`.<br>• Model only interprets calculated slots; user reviews before final commit. | Low (2) |
| **AIR-04** | **Upstream Provider Outage**: Primary LLM API becomes unavailable or returns 5xx/timeouts. | Moderate (2) | Probable (3) | High (6) | • LiteLLM multi-tier fallback routing: Primary -> Fallback -> Emergency model.<br>• Circuit-breaker timeouts (default 15s). | Low (2) |
| **AIR-05** | **Denial of Service / Token Exhaustion**: Repetitive loops or oversized context exhausts quota and resources. | Moderate (2) | Possible (2) | Medium (4) | • Per-user rate limiting (20 req/60s).<br>• Sliding message window truncation (capped to 10 most recent messages). | Low (1) |
| **AIR-06** | **Credential & Data Leakage**: Sensitive API tokens leaked to clients or models. | Critical (3) | Unlikely (1) | Medium (3) | • Tokens Fernet-encrypted at rest with key separation.<br>• Admin endpoints never return raw secrets.<br>• Prompt forbids copilot from requesting/storing keys. | Low (1) |

---

## 3. Human-in-the-Loop Oversight Protocol (ISO 42001 Annex A.7 / NIST MANAGE 2)

1. **Read & Analytical Operations**:
   - Free/busy lookups, agenda summaries, conflict explanations, and contact queries execute autonomously as read-only operations.
2. **State Mutating Operations (Calendar & Contacts)**:
   - Creating events, modifying times, deleting entries, or linking attendees must return an action plan and draft identifier.
   - The user must explicitly inspect and confirm the action (`confirm_action`) in the UI.
3. **Reversibility**:
   - `undo_last_copilot_action` is maintained to permit instantaneous rollback of recent confirmed operations.

---

## 4. Incident Response & Model Rollback Runbook

1. **Detection**:
   - Alert triggered if 5xx error rate from LiteLLM proxy exceeds 5% over 5 minutes or if rate-limit triggers spike abnormally.
2. **Immediate Containment**:
   - Admin navigates to `/settings/ai` and switches routing strategy or activates Emergency Model.
   - If severe vulnerability is observed, toggle Copilot feature flag off instantly via environment / admin settings.
3. **Post-Incident Analysis**:
   - Review prompt logs (sanitized of PII) to identify root cause.
   - Add targeted automated regression tests to `apps/api/tests/test_ai_trustworthiness.py`.

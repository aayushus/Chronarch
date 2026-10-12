# Chronarch AI Governance Statement & System Inventory
**Framework Alignment**: NIST AI Risk Management Framework 1.0 (AI RMF) & ISO/IEC 42001:2023 (Artificial Intelligence Management System - AIMS)

---

## 1. Context & Scope (ISO 42001 Clause 4 / NIST GOVERN 1)

Chronarch is an enterprise-grade, high-integrity executive calendar platform. Its AI subsystem comprises:
1. **Executive Calendar Copilot**: A specialized generative assistant allowing natural-language calendar queries, schedule draft creation, conflict analysis, and contact linkage.
2. **AI Proxy / Routing Engine (LiteLLM Gateway)**: An administrative model router providing unified access, key encryption at rest, automatic failover (primary -> fallback -> emergency models), and request throttling.

### EU AI Act Classification
- **Risk Tier**: **Limited / Minimal Risk**.
- **Rationale**: Chronarch Copilot operates strictly in calendar scheduling, productivity assistance, and contact management. It does not perform biometric categorization, credit scoring, autonomous employment decisions, or safety-critical physical infrastructure control.

---

## 2. NIST Trustworthy AI Characteristics Mapping

| Characteristic | Chronarch Implementation & Controls | Verification Mechanism |
|---|---|---|
| **1. Valid & Reliable** | Strict tool interfaces, Pydantic type validation, idempotency keys, ISO 8601 UTC time standardization. | `eval_copilot.py`, unit test suite. |
| **2. Safe** | Two-stage commit for all state modifications (`confirm_action`); Copilot never performs autonomous calendar writes or deletions without explicit user sign-off. | `test_copilot_confirm.py` |
| **3. Secure & Resilient** | Isolated LiteLLM proxy, Fernet-encrypted credentials at rest, multi-provider failover routing, rate limiting (20 req/min). | `admin_ai_router.py`, `test_ai_trustworthiness.py` |
| **4. Accountable & Transparent** | All tool calls, system inputs, and responses are auditable. Users clearly see what tool the Copilot intends to invoke before confirmation. | Audit log stream (`audit_log` table), UI confirm cards. |
| **5. Explainable & Interpretable** | Copilot explains reasons for schedule recommendations and conflicts in plain language citing the underlying calendar events. | Copilot prompt guidelines (`system.md`). |
| **6. Privacy-Enhanced** | Zero-Data-Retention (ZDR) architecture. Calendar data is not used for model training. Conversation history is ephemeral. | Prompt instructions, provider privacy configurations. |
| **7. Fair with Harmful Bias Managed** | Standardized availability engine calculation. Decisions rely solely on mathematical free/busy intervals, not demographic factors. | `chronarch_core.availability` engine. |

---

## 3. Leadership & Accountability (ISO 42001 Clause 5 / NIST GOVERN 2)

- **AI System Owner**: Head of Product / Engineering.
- **AI Security & Governance Lead**: Application Security Officer.
- **Review Cycle**: Quarterly AI risk and trustworthiness review, continuous automated CI regression verification.

---

## 4. AI Lifecycle Management (ISO 42001 Clause 8 / NIST MANAGE)

1. **Design & Planning**: Any new AI tool capability must undergo least-privilege review. No raw shell, DB execution, or arbitrary file system tools may be granted.
2. **Development**: All prompts, system instructions, and tool definitions must be maintained in version control (`packages/core/chronarch_core/prompts`).
3. **Evaluation**: Changes to prompts or models must pass `scripts/eval_copilot.py` with 100% boundary compliance.
4. **Deployment**: Multi-provider failover ensures high availability across upstream provider outages.
5. **Monitoring & Decommissioning**: Telemetry on latency, fallback triggers, and 429 rate limit events. Old models can be immediately re-routed without application restart via `admin_ai_router`.

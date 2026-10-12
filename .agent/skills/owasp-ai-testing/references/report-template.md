# OWASP AI Testing — Assessment Report Template

Copy-ready output structure for an OWASP AI Testing Guide assessment
(see `SKILL.md` → "Output Format").

```markdown
# OWASP AI Testing Guide - Assessment Report

**System**: [Name]
**Architecture**: [Type - LLM/Classifier/RAG/Agent/etc.]
**Date**: [Date]
**Evaluator**: [AI Agent or Human]
**OWASP AI Testing Guide Version**: v1 (2025)
**Scope**: [Layers tested]

---

## Executive Summary

### Overall Trustworthiness: [Critical Risk / High Risk / Medium Risk / Low Risk / Trustworthy]

### Test Coverage
| Layer | Tests Executed | Pass | Fail | N/A |
|---|---|---|---|---|
| Application (APP) | [X/14] | [X] | [X] | [X] |
| Model (MOD) | [X/7] | [X] | [X] | [X] |
| Infrastructure (INF) | [X/6] | [X] | [X] | [X] |
| Data (DAT) | [X/5] | [X] | [X] | [X] |
| **Total** | **[X/32]** | **[X]** | **[X]** | **[X]** |

### Critical Findings
1. [Finding] - [Test ID] - [Severity]
2. [Finding] - [Test ID] - [Severity]
3. [Finding] - [Test ID] - [Severity]

---

## Detailed Test Results

### Layer 1: Application Testing

#### AITG-APP-01: Prompt Injection
**Result**: [PASS / FAIL / PARTIAL / N/A]
**Severity**: [Critical / High / Medium / Low]

**Test Performed:**
- [Test description]

**Evidence:**
- [Payload used]
- [Response observed]
- [Screenshots/logs]

**Finding:**
[Detailed description of vulnerability or confirmation of control]

**Recommendation:**
[Specific remediation steps]

---

[Continue for each test case...]

---

## Remediation Roadmap

### Phase 1: Critical (0-7 days)
| Test ID | Finding | Action | Owner |
|---|---|---|---|
| [ID] | [Finding] | [Action] | [Owner] |

### Phase 2: High (7-30 days)
[Continue...]

### Phase 3: Medium (30-90 days)
[Continue...]

---

## Trustworthiness Assessment

| Dimension | Status | Evidence |
|---|---|---|
| Security | [Status] | [Key findings] |
| Fairness | [Status] | [Key findings] |
| Privacy | [Status] | [Key findings] |
| Reliability | [Status] | [Key findings] |
| Explainability | [Status] | [Key findings] |
| Safety | [Status] | [Key findings] |

---

## Next Steps

1. [ ] Remediate critical findings immediately
2. [ ] Schedule follow-up testing after remediation
3. [ ] Integrate test cases into CI/CD pipeline
4. [ ] Establish continuous monitoring
5. [ ] Plan periodic reassessment

---

## Resources

- [OWASP AI Testing Guide](https://owasp.org/www-project-ai-testing-guide/)
- [OWASP GenAI Security Project](https://genai.owasp.org/)
- [OWASP AI Testing Guide GitHub](https://github.com/OWASP/www-project-ai-testing-guide)

---

**Report Version**: 1.0
**Date**: [Date]
```

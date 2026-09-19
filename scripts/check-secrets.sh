#!/bin/sh
# Pre-commit secret scan: blocks commits containing real-looking credentials.
# Installed to .git/hooks/pre-commit (see bottom). Keep patterns tight to
# avoid flagging the `gsk-test*` dummies under */tests/.
#
# Install: cp scripts/check-secrets.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

STAGED=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$STAGED" ] && exit 0

fail=0
report() {
  echo "pre-commit: blocked — possible secret: $1"
  fail=1
}

# 1. Filenames that must never be committed.
echo "$STAGED" | grep -Ei '(^|/)\.env$|credentials\.json|service-account.*\.json|\.pem$|\.key$|\.p12$|\.pfx$' \
  | while read -r f; do report "forbidden filename $f"; done
[ "$(echo "$STAGED" | grep -Eic '(^|/)\.env$|credentials\.json|service-account.*\.json|\.pem$|\.key$|\.p12$|\.pfx$')" -gt 0 ] && fail=1

# 2. Content patterns (exclude tests + examples, which use dummies).
CONTENT=$(git diff --cached -- . ':(exclude)*/tests/*' ':(exclude)*.example' | grep '^+' | grep -v '^+++')
echo "$CONTENT" | grep -Ei 'sk-(live|ant|proj)-[0-9A-Za-z_-]{10,}|AIza[0-9A-Za-z_-]{20,}|xox[bap]-|ghp_[0-9A-Za-z]{20,}|gsk_[0-9A-Za-z]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY' \
  && { echo "pre-commit: blocked — key-like content above"; fail=1; }

# 3. Assignments that look like real pasted secrets (long opaque values).
echo "$CONTENT" | grep -Ei '(client_secret|api[_-]?key|password|passwd|secret)\s*[:=]\s*["'"'"']?[0-9A-Za-z._~+/-]{24,}["'"'"']?' \
  | grep -Evi 'test|example|placeholder|change-?me|your-|sk-litellm-dev|dev-secret' \
  && { echo "pre-commit: blocked — secret-like assignment above"; fail=1; }

exit $fail

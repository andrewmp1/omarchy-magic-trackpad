#!/usr/bin/env bash
# One command to check the plugin before committing / releasing.
#
#   1. unit tests        Model.js logic, manifest sanity, generated-Lua syntax
#   2. manifest schema   `omarchy plugin validate` (if omarchy is installed)
#   3. qmllint           informational — qs.* imports never resolve outside
#                        Quickshell, so this is a "read it", not a gate
#   4. hyprland contract  runs only inside a Hyprland session; safe (save+restore)
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "== 1. unit tests =="
node --test tests/model.test.js tests/manifest.test.js tests/lua.test.js || fail=1

echo
echo "== 2. manifest schema =="
if command -v omarchy >/dev/null 2>&1; then
  if omarchy plugin validate .; then echo "  ok"; else echo "  FAILED"; fail=1; fi
else
  echo "  (omarchy not installed — skipped)"
fi

echo
echo "== 3. qmllint (informational) =="
QL="$(command -v qmllint 2>/dev/null || true)"
[ -z "$QL" ] && [ -x /usr/lib/qt6/bin/qmllint ] && QL=/usr/lib/qt6/bin/qmllint
if [ -n "$QL" ]; then
  # qs.Commons / qs.Ui never resolve outside a running Quickshell, so the
  # import, unresolved-type, unqualified and inheritance-cycle categories are
  # all false positives here. Silence those; a genuine QML *syntax* error
  # still surfaces (and still exits non-zero).
  "$QL" -I "${OMARCHY_PATH:-/usr/share/omarchy}/shell" \
    --import disable --unresolved-type disable --unqualified disable \
    --unused-imports disable --missing-type disable --signal-handler-parameters disable --required disable \
    ./*.qml 2>&1 | sed 's/^/  /' || true
else
  echo "  (qmllint not found — skipped; install qt6 qmllint)"
fi

echo
echo "== 4. hyprland contract =="
if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
  node --test tests/hypr-contract.test.js || fail=1
else
  echo "  (not in a Hyprland session — skipped)"
fi

echo
echo "== 5. shell smoke (loads + opens without a QML error) =="
if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] && command -v omarchy-shell >/dev/null; then
  bash tests/smoke.sh; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 77 ] || fail=1
else
  echo "  (needs a running omarchy-shell — skipped)"
fi

echo
echo "== 6. panel e2e (synthetic keystrokes -> real side effects) =="
if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] && command -v wtype >/dev/null; then
  sleep 3   # let the widget settle after layer 5 poked the shell
  bash tests/e2e.sh || fail=1
else
  echo "  (needs a Hyprland session + wtype — skipped)"
fi

echo
if [ "$fail" -eq 0 ]; then echo "ALL GATING CHECKS PASSED"; else echo "CHECKS FAILED"; fi
exit "$fail"

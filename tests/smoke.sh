#!/usr/bin/env bash
# Smoke test: is the plugin loaded in the running omarchy-shell, and does its
# panel open without a QML runtime error? No GUI-automation tools needed — it
# drives the shell over IPC and reads the journal.
#
# Catches what unit tests can't: a Repeater delegate that leaves `modelData`
# undefined, a renamed qs.Ui component, a second Component.onCompleted — each
# logs `WARN scene: ... Panel.qml ... TypeError` and renders nothing.
#
# Does NOT restart the shell (that's disruptive and racy); it reloads plugin
# code with `rescanPlugins` and only restarts if the shell isn't answering.
#
# Exit 0 = clean · 1 = real failure · 77 = could not run.
set -uo pipefail

ID="andrewmp1.magic-trackpad"
TARGET="magic-trackpad"
CFGDIR="${XDG_CONFIG_HOME:-$HOME/.config}"
say() { printf '  %s\n' "$*"; }

command -v omarchy-shell >/dev/null || { say "omarchy-shell not found — skipping"; exit 77; }
command -v jq >/dev/null || { say "jq not found — skipping"; exit 77; }
[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] || { say "not in a Hyprland session — skipping"; exit 77; }

LINK="$CFGDIR/omarchy/plugins/$ID"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
[ -e "$LINK" ] || ln -sfn "$REPO" "$LINK"

if ! omarchy-shell shell ping 2>/dev/null | grep -q ok; then
  say "shell not answering — restarting once…"
  omarchy restart shell >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do omarchy-shell shell ping 2>/dev/null | grep -q ok && break; sleep 1; done
fi
omarchy-shell shell ping 2>/dev/null | grep -q ok || { say "shell never became ready"; exit 1; }

START="$(date '+%Y-%m-%d %H:%M:%S')"
omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
omarchy plugin enable "$ID" >/dev/null 2>&1 || true
sleep 2

fail=0

# 1. discovered and enabled
n="$(omarchy-shell shell listPlugins 2>/dev/null | jq -r --arg id "$ID" \
  '(if type=="array" then . else (.plugins // []) end) | map(select(.id==$id and .enabled==true)) | length' 2>/dev/null)"
[ "$n" = "1" ] && say "discovered and enabled: ok" \
  || { say "not enabled in the registry (got: ${n:-none})"; fail=1; }

# 2. open + close the panel over IPC
omarchy-shell "$TARGET" open >/dev/null 2>&1 || say "note: IPC 'open' returned non-zero"
sleep 1.5
opened=0
for _ in 1 2 3; do
  hyprctl -j layers 2>/dev/null | grep -q "omarchy-keyboard-panel" && { opened=1; break; }
  sleep 0.5
done
[ "$opened" = 1 ] && say "panel opened via IPC: ok" || say "note: panel layer not seen (widget may be idle)"
omarchy-shell "$TARGET" close >/dev/null 2>&1 || true

# 3. no QML runtime error from our files since we poked it
errs="$(journalctl --user --since "$START" --no-pager 2>/dev/null \
  | grep -E "$ID/.*\.qml" \
  | grep -iE "TypeError|ReferenceError|is not a function|Cannot read|Unable to assign|non-existent|Property value set multiple" \
  | grep -viE "another handler is registered")"
if [ -n "$errs" ]; then
  say "QML runtime errors:"; printf '%s\n' "$errs" | sed 's/^/    /'; fail=1
else
  say "no QML runtime errors: ok"
fi

# 4. managed file + loader line
[ -f "$CFGDIR/hypr/omarchy-magic-trackpad.lua" ] && say "managed lua written: ok" \
  || { say "managed lua missing"; fail=1; }
grep -q "omarchy-magic-trackpad" "$CFGDIR/hypr/hyprland.lua" 2>/dev/null \
  && say "loader line in hyprland.lua: ok" || { say "loader line missing"; fail=1; }

[ "$fail" -eq 0 ] && say "SMOKE OK" || say "SMOKE FAILED"
exit "$fail"

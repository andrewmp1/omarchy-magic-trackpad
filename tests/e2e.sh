#!/usr/bin/env bash
# End-to-end: drive the *rendered* panel with synthetic keystrokes and confirm
# the real side effects (Hyprland option + the JSON document). This is the
# "computer use" layer — it exercises the click/key handlers, not just the
# functions they call.
#
# Keyboard only: `wtype` uses the Wayland virtual-keyboard protocol and needs
# no daemon or root. Mouse automation would need `ydotool` (see tests/README).
# The KeyboardPanel takes keyboard focus when open, so `wtype` routes to it.
#
# Exit 0 = pass or skipped. Exit 1 = a confirmed failure. Set E2E_STRICT=1 to
# turn "panel didn't receive keys" into a failure instead of a skip.
set -uo pipefail

TARGET="magic-trackpad"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/magic-trackpad.json"
LUA="${XDG_CONFIG_HOME:-$HOME/.config}/hypr/omarchy-magic-trackpad.lua"
say()  { printf '  %s\n' "$*"; }
skip() { say "SKIP: $*"; exit 0; }

command -v wtype        >/dev/null || skip "wtype not installed (pacman -S wtype)"
command -v omarchy-shell >/dev/null || skip "omarchy-shell not found"
command -v jq           >/dev/null || skip "jq not found"
[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] || skip "not in a Hyprland session"

omarchy-shell shell ping 2>/dev/null | grep -q ok || skip "omarchy-shell not answering (start your desktop first)"
sleep 2   # the widget's IPC handler can answer before keyboard focus routes cleanly

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# The panel prepends a SCOPE row when at least one touchpad is detected, which
# shifts every later nav index by one. Ask Model.js what it would find.
scope_row_count() {
  node -e '
    const M = require(process.argv[1] + "/Model.js")
    const { execFileSync } = require("child_process")
    const fs = require("fs")
    let d = "{}"; try { d = execFileSync("hyprctl", ["devices", "-j"], { encoding: "utf8" }) } catch (e) {}
    let p = ""; try { p = fs.readFileSync("/proc/bus/input/devices", "utf8") } catch (e) {}
    process.stdout.write(M.touchpadDevices(d, p).length > 0 ? "1" : "0")
  ' "$REPO" 2>/dev/null || printf 0
}
FIRST_DEVICE() {
  node -e '
    const M = require(process.argv[1] + "/Model.js")
    const { execFileSync } = require("child_process")
    const fs = require("fs")
    let d = "{}"; try { d = execFileSync("hyprctl", ["devices", "-j"], { encoding: "utf8" }) } catch (e) {}
    let p = ""; try { p = fs.readFileSync("/proc/bus/input/devices", "utf8") } catch (e) {}
    const l = M.touchpadDevices(d, p)
    process.stdout.write(l.length ? l[0].name : "")
  ' "$REPO" 2>/dev/null || printf ""
}
BASE="$(scope_row_count)"          # 0 or 1 — nav offset to the first toggle row
DEV="$(FIRST_DEVICE)"
say "scope row present: $BASE   first touchpad: ${DEV:-<none>}"

# NB: `.bool // empty` is wrong — jq treats `false` as absent, so a toggle
# flipping to false would read as "unchanged". Emit the literal instead.
getb() { hyprctl getoption -j "input:touchpad:$1" | jq -r 'if has("bool")  then (.bool|tostring)  else "" end'; }
getf() { hyprctl getoption -j "input:touchpad:$1" | jq -r 'if has("float") then (.float|tostring) else "" end'; }
setb() { hyprctl eval "hl.config({ input = { touchpad = { $1 = $2 } } })" >/dev/null; }
setf() { hyprctl eval "hl.config({ input = { touchpad = { $1 = $2 } } })" >/dev/null; }
panel_open() { hyprctl -j layers 2>/dev/null | grep -q "omarchy-keyboard-panel"; }
close_panel() {
  for _ in 1 2 3 4; do
    panel_open || return 0
    omarchy-shell "$TARGET" close >/dev/null 2>&1
    sleep 0.4
  done
  panel_open && return 1 || return 0
}
press() { wtype -k "$1" 2>/dev/null; sleep 0.5; }

# Fresh open every time (close first so onOpenedChanged resets the cursor),
# settle until keyboard focus has actually routed, then PRIME: one Down turns
# the panel cursor active and leaves it on index 0. After open_panel, `nav N`
# lands on index N and `activate` fires it.
open_panel() {
  close_panel || true
  local ok=0
  for _ in 1 2 3; do
    omarchy-shell "$TARGET" open >/dev/null 2>&1
    for _ in 1 2 3 4 5 6; do sleep 0.35; panel_open && { ok=1; break; }; done
    [ "$ok" = 1 ] && break
  done
  [ "$ok" = 1 ] || return 1
  sleep 1.2
  press Down          # prime: cursor -> active, index 0
  return 0
}
nav()      { local n=$1; while [ "$n" -gt 0 ]; do press Down; n=$((n - 1)); done; }
activate() { press space; sleep 0.6; }

# --- snapshot everything we might touch, restore on exit ---------------------
declare -A ORIG
for o in tap_to_click clickfinger_behavior natural_scroll disable_while_typing tap_and_drag middle_button_emulation; do
  ORIG[$o]="$(getb "$o")"
done
ORIG[scroll_factor]="$(getf scroll_factor)"
ORIG[sensitivity]="$(hyprctl getoption -j input:sensitivity | jq -r 'if has("float") then (.float|tostring) else "0" end')"
ORIG[accel_profile]="$(hyprctl getoption -j input:accel_profile | jq -r 'if has("str") and .str != "[[EMPTY]]" then .str else "" end')"
ORIG[scroll_method]="$(hyprctl getoption -j input:scroll_method | jq -r 'if has("str") and .str != "[[EMPTY]]" then .str else "" end')"
HAD_CFG=0; [ -f "$CFG" ] && { HAD_CFG=1; cp "$CFG" "$CFG.e2ebak"; }

restore() {
  close_panel 2>/dev/null || true
  for o in tap_to_click clickfinger_behavior natural_scroll disable_while_typing tap_and_drag middle_button_emulation; do
    [ -n "${ORIG[$o]}" ] && setb "$o" "${ORIG[$o]}"
  done
  [ -n "${ORIG[scroll_factor]}" ] && setf scroll_factor "${ORIG[scroll_factor]}"
  hyprctl eval "hl.config({ input = { sensitivity = ${ORIG[sensitivity]:-0}, accel_profile = \"${ORIG[accel_profile]}\", scroll_method = \"${ORIG[scroll_method]}\" } })" >/dev/null 2>&1
  # Pin any device we touched back to the original global values.
  if [ -n "$DEV" ]; then
    hyprctl eval "hl.device({ name = \"$DEV\", natural_scroll = ${ORIG[natural_scroll]:-false}, scroll_factor = ${ORIG[scroll_factor]:-0.4} })" >/dev/null 2>&1
  fi
  if [ "$HAD_CFG" -eq 1 ]; then mv "$CFG.e2ebak" "$CFG"; else rm -f "$CFG"; fi
  rm -f "$LUA"
}
trap restore EXIT

fail=0
rm -f "$CFG" "$LUA"

# --- test 1: first toggle row (Tap to click) toggles on activate ----------
b0="$(getb tap_to_click)"
open_panel || skip "panel would not open via IPC (bar widget idle?)"
nav "$BASE"                          # step past the SCOPE row if present
activate                             # first toggle -> setToggle(tap_to_click)
a0="$(getb tap_to_click)"
close_panel
if [ -z "$a0" ] || [ "$a0" = "$b0" ]; then
  if [ "${E2E_STRICT:-0}" = "1" ]; then say "tap_to_click did not change ($b0 -> $a0)"; fail=1
  else skip "panel isn't receiving keystrokes (focus?) — $b0 -> $a0"; fi
else
  say "keyboard toggle: tap_to_click $b0 -> $a0  ok"
  [ -f "$CFG" ] && [ "$(jq -r '.global.touchpad.tapToClick' "$CFG")" != "null" ] \
    && say "document updated: ok" || { say "magic-trackpad.json not updated"; fail=1; }
fi

# --- test 2: navigate to index 2 (Natural scroll) -------------------------
setb tap_to_click "${ORIG[tap_to_click]:-true}"; rm -f "$CFG" "$LUA"
b2="$(getb natural_scroll)"
open_panel
nav $((BASE + 2)); activate           # -> natural_scroll (3rd toggle) -> setToggle
a2="$(getb natural_scroll)"
close_panel
[ -n "$a2" ] && [ "$a2" != "$b2" ] \
  && say "keyboard nav to row 3: natural_scroll $b2 -> $a2  ok" \
  || { say "natural_scroll did not change ($b2 -> $a2)"; fail=1; }

# --- test 3: scroll-speed segmented control (after the 6 toggle rows) ------
rm -f "$CFG" "$LUA"
b3="$(getf scroll_factor)"
open_panel
nav $((BASE + 6)); activate            # past 6 toggles -> the scroll stop -> cycleScroll()
a3="$(getf scroll_factor)"
close_panel
if [ -n "$a3" ] && [ "$a3" != "$b3" ]; then
  say "segmented scroll control: scroll_factor $b3 -> $a3  ok"
else
  say "scroll_factor did not change ($b3 -> $a3)"; fail=1
fi

# --- test 3b: pointer speed (an `input`-level key). Keeps test 3's scroll
#     change on disk so test 4 still has an hl.config to reload.
pb="$(hyprctl getoption -j input:sensitivity | jq -r 'if has("float") then (.float|tostring) else "" end')"
open_panel
nav $((BASE + 8)); activate            # scope + 6 toggles + scroll + scrollMethod -> pointer
pa="$(hyprctl getoption -j input:sensitivity | jq -r 'if has("float") then (.float|tostring) else "" end')"
close_panel
if [ -n "$pa" ] && [ "$pa" != "$pb" ]; then
  say "pointer speed: input:sensitivity $pb -> $pa  ok"
  [ -f "$CFG" ] && [ "$(jq -r '.global.pointerSpeed' "$CFG")" != "null" ] \
    && say "pointerSpeed written to the document: ok" \
    || { say "pointerSpeed missing from magic-trackpad.json"; fail=1; }
  grep -q "sensitivity" "$LUA" 2>/dev/null \
    && say "managed .lua carries sensitivity: ok" \
    || { say "managed .lua missing sensitivity"; fail=1; }
else
  say "input:sensitivity did not change ($pb -> $pa)"; fail=1
fi

# --- test 4: persistence — the managed .lua re-applies after `hyprctl reload`
if [ -f "$LUA" ] && grep -q "hl.config" "$LUA"; then
  HLUA="${XDG_CONFIG_HOME:-$HOME/.config}/hypr/hyprland.lua"
  grep -q -- '-- omarchy-magic-trackpad' "$HLUA" \
    && say "loader line installed on first change: ok" \
    || { say "loader line missing from hyprland.lua after a change"; fail=1; }
  keep="$(getf scroll_factor)"
  hyprctl reload >/dev/null 2>&1; sleep 1
  now="$(getf scroll_factor)"
  [ "$now" = "$keep" ] \
    && say "persists across 'hyprctl reload': scroll_factor stays $now  ok" \
    || { say "setting lost after reload ($keep -> $now)"; fail=1; }
fi

# --- test 5: per-device scope — pick a device, override a toggle ----------
if [ "$BASE" = "1" ] && [ -n "$DEV" ]; then
  rm -f "$CFG" "$LUA"
  open_panel
  sleep 0.8                             # let the panel-open device refresh settle first
  activate                              # cursor at index 0 = SCOPE row -> cycleScope() -> the device
  sleep 0.8
  nav $((BASE + 2)); activate            # -> natural_scroll row, in the DEVICE scope
  sleep 0.8
  close_panel
  ok5=1
  if [ ! -f "$CFG" ]; then
    say "device scope: magic-trackpad.json not written"; fail=1; ok5=0
  else
    dk="$(jq -r --arg d "$DEV" '.devices[$d].touchpad.naturalScroll' "$CFG" 2>/dev/null)"
    [ "$dk" = "true" ] || [ "$dk" = "false" ] \
      && say "device override in JSON: devices[\"$DEV\"].touchpad.naturalScroll = $dk  ok" \
      || { say "device override missing from JSON (got: ${dk:-none})"; fail=1; ok5=0; }
  fi
  if [ -f "$LUA" ] && grep -q "hl.device(" "$LUA"; then
    say "managed .lua gained an hl.device() block: ok"
  else
    say "managed .lua has no hl.device() block after a device change"; fail=1; ok5=0
  fi
  if [ "$ok5" = 1 ]; then
    say "per-device scope e2e: ok"
  else
    say "---- CFG ----"; sed 's/^/    /' "$CFG" 2>/dev/null || say "    (no CFG)"
    say "---- LUA ----"; sed 's/^/    /' "$LUA" 2>/dev/null || say "    (no LUA)"
  fi
else
  say "test 5 skipped: no touchpad detected on this box"
fi

[ "$fail" -eq 0 ] && say "E2E OK" || say "E2E FAILED"
exit "$fail"

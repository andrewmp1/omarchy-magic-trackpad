# Testing

Six layers, cheapest first. `bash scripts/check.sh` runs all of them and
exits non-zero on a real failure; `npm test` runs just the machine-portable
ones.

| # | Layer | File | Needs | In `check.sh` | In CI |
|---|---|---|---|---|---|
| 1 | Unit — pure logic | `tests/model.test.js` | node | yes | yes |
| 2 | Manifest / id consistency | `tests/manifest.test.js` | node | yes | yes |
| 3 | Generated-Lua syntax | `tests/lua.test.js` | node + `luac` | yes | yes |
| 4 | Hyprland contract | `tests/hypr-contract.test.js` | live Hyprland | yes (skips off-desktop) | no |
| 5 | Shell smoke | `tests/smoke.sh` | running `omarchy-shell` | yes (skips off-desktop) | no |
| 6 | Panel e2e (computer use) | `tests/e2e.sh` | Hyprland + `wtype` | yes (skips w/o `wtype`) | no |

## What each layer catches

**1–3 (portable, run anywhere incl. CI):**
- config normalization / repair of hand-edited JSON, and the **v1 → v2
  config-document migration** (a `{version:1, touchpad, scrollSpeed}` doc lands
  under `global` with nothing lost)
- touchpad detection from `hyprctl devices` + `/proc/bus/input/devices`
  fixtures (a mouse+touchpad mix, and the no-signal fallback), and
  device-name rejection (anchored allow-list, refuse-not-repair)
- the scope cascade: `effectiveToggle` / `effectiveScroll` resolve
  device → global → live in that order
- the exact `hl.config` / `hl.device` strings and the batched apply plan
  (Global only → 1 eval; Global + a device → `hl.config` then `hl.device`)
- the generated `~/.config/hypr/omarchy-magic-trackpad.lua` **parses as Lua**
  for every shape incl. per-device blocks (a syntax error there would break
  the user's whole Hyprland config)
- the one-line loader edit to `hyprland.lua` is idempotent and still valid Lua
- `BarWidget.qml` `moduleName` == manifest `id`; README/AGENTS mention it
  (guards the "rename the handle everywhere" footgun)

**4 — Hyprland contract (the API-drift tripwire):**
For every touchpad option + scroll, it reads the current value, applies it
with the plugin's *own* command (`hyprctl eval "hl.config{…}"`), asserts
`hyprctl getoption` changed, and restores. This is the layer that caught
`hyprctl keyword` being rejected by Omarchy's Lua parser. If a future
Hyprland renames an option or changes `eval`, these go red. It also fires
`hl.device({ name = <a detected touchpad> })` and asserts `ok` (per-device
has no `getoption` read-back to verify against), restoring the device to
Global's values afterward — skipped when no touchpad is present.

**5 — shell smoke (no GUI tools):**
Reloads the plugin into the running `omarchy-shell`, opens the panel over
IPC, and greps the journal for a QML `TypeError` / `ReferenceError` from our
files. Catches a Repeater delegate that leaves `modelData` undefined, a
renamed `qs.Ui` component, a duplicate `Component.onCompleted` — all of which
render nothing and only show up in the log.

**6 — panel e2e (synthetic keystrokes → real effects):**
Opens the panel, drives the keyboard-cursor with `wtype` (Wayland
virtual-keyboard protocol — no daemon, no root), and asserts the real
outcome. `$BASE` is `1` when the panel shows a SCOPE row (a touchpad is
detected) and `0` otherwise; every nav count below is offset by it:
- `nav $BASE; activate` flips `input:touchpad:tap_to_click` **and** writes
  `.global.touchpad.tapToClick` in `~/.config/omarchy/magic-trackpad.json`
- `nav $((BASE+2)); activate` flips `natural_scroll` (keyboard nav works)
- `nav $((BASE+6)); activate` cycles the scroll-speed segmented control
- after `hyprctl reload`, the value **persists** (the managed `.lua`
  re-applied it)
- **per-device (when `$BASE` is 1):** `activate` the SCOPE row → the panel
  switches to the detected touchpad; `nav $((BASE+2)); activate` writes
  `.devices["<slug>"].touchpad.naturalScroll` and adds an `hl.device(` block
  to the managed `.lua`

It restores every value it touched on exit (including re-pinning any device
it scoped). Off-desktop or without `wtype` it skips (exit 0); set
`E2E_STRICT=1` to make "panel didn't receive keys" a failure.

## Manual checklist (do this before tagging a release)

1. `omarchy plugin add …` (or symlink) → `omarchy plugin enable` → the
   trackpad glyph appears in the bar.
2. Left-click it → the panel opens under the icon.
3. Flip **Natural scroll** → two-finger scrolling reverses immediately;
   `hyprctl getoption -j input:touchpad:natural_scroll` shows the new value;
   `~/.config/omarchy/magic-trackpad.json` gains `"naturalScroll"`.
4. Change **Scroll speed** to Fast → scrolling is noticeably quicker.
5. **Per-device** (needs an external touchpad, e.g. a Magic Trackpad):
   - The **Scope** picker shows **Global** + the pad. Pick the pad.
   - Toggle rows read "Inherited from Global" until changed. Flip
     **Natural scroll** off → only *that* pad reverses; the built-in pad is
     unchanged. `~/.config/omarchy/magic-trackpad.json` gains
     `devices["<slug>"]`; the managed `.lua` gains
     `hl.device({ name = "<slug>", natural_scroll = … })`.
   - **Reset <pad> to Global** → confirm → the pad's overrides clear and it
     tracks Global again.
   - `hyprctl reload` and `omarchy restart shell` → the override persists.
   - Unplug the pad → the Scope picker drops it and the panel falls back to
     Global.
6. `hyprctl reload` → settings stick.
7. `omarchy plugin disable andrewmp1.magic-trackpad` → glyph gone;
   `omarchy plugin enable …` → it comes back with your settings intact.
8. `omarchy restart shell` → panel still shows your values; bar glyph is lit.
9. Log out and back in → settings still applied (the loader line in
   `hyprland.lua` did its job).
10. Keyboard: open panel, `j`/`k` move, `Enter` toggles, `Esc` closes.
11. `omarchy plugin remove andrewmp1.magic-trackpad` then delete the two
    generated files + the loader line → Hyprland is exactly as before.

## Mouse automation (optional)

`tests/e2e.sh` is keyboard-only because `wtype` needs nothing. Clicking the
switches with the *pointer* needs `ydotool`:

```sh
sudo pacman -S ydotool
sudo usermod -aG input "$USER"          # for /dev/uinput; re-login
systemctl --user enable --now ydotool   # or run `ydotoold` yourself
```

Then a test can `ydotool mousemove --absolute -x <col> -y <row>` onto a
switch (compute the row from the panel-card rect in `hyprctl -j layers`) and
`ydotool click 0xC0`, asserting the same `getoption` / JSON outcomes. Not
wired up — the keyboard path already exercises the same handlers.

## Headless CI GUI test (not built)

A full GUI test *could* run in CI on an Arch container:

```
Hyprland with WLR_BACKENDS=headless   # nested, no physical display
  → start omarchy-shell
  → enable the plugin
  → wtype / ydotool to drive it
  → grim to screenshot, magick compare to a baseline
```

It's a real project (Arch image + Quickshell + the Omarchy shell package in
CI) and Omarchy-version-coupled. Layers 1–3 in CI plus layers 4–6 on your
own desktop cover the same ground for far less upkeep.

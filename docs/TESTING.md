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
- config normalization / repair of hand-edited JSON
- the exact `hl.config` / `hl.gesture` strings and the batched apply plan
- the generated `~/.config/hypr/omarchy-magic-trackpad.lua` **parses as Lua**
  (a syntax error there would break the user's whole Hyprland config)
- the one-line loader edit to `hyprland.lua` is idempotent and still valid Lua
- `BarWidget.qml` `moduleName` == manifest `id`; README/AGENTS mention it
  (guards the "rename the handle everywhere" footgun)

**4 — Hyprland contract (the API-drift tripwire):**
For every touchpad option + scroll, it reads the current value, applies it
with the plugin's *own* command (`hyprctl eval "hl.config{…}"`), asserts
`hyprctl getoption` changed, and restores. This is the layer that caught
`hyprctl keyword` being rejected by Omarchy's Lua parser. If a future
Hyprland renames an option or changes `eval`, these go red.

**5 — shell smoke (no GUI tools):**
Reloads the plugin into the running `omarchy-shell`, opens the panel over
IPC, and greps the journal for a QML `TypeError` / `ReferenceError` from our
files. Catches a Repeater delegate that leaves `modelData` undefined, a
renamed `qs.Ui` component, a duplicate `Component.onCompleted` — all of which
render nothing and only show up in the log.

**6 — panel e2e (synthetic keystrokes → real effects):**
Opens the panel, drives the keyboard-cursor with `wtype` (Wayland
virtual-keyboard protocol — no daemon, no root), and asserts the real
outcome:
- `activate` on row 0 flips `input:touchpad:tap_to_click` **and** writes
  `~/.config/omarchy/magic-trackpad.json`
- `nav 2; activate` flips `natural_scroll` (keyboard navigation works)
- `nav 6; activate` cycles the scroll-speed segmented control
- after `hyprctl reload`, the value **persists** (the managed `.lua`
  re-applied it)

It restores every value it touched on exit. Off-desktop or without `wtype`
it skips (exit 0); set `E2E_STRICT=1` to make "panel didn't receive keys" a
failure.

## Manual checklist (do this before tagging a release)

1. `omarchy plugin add …` (or symlink) → `omarchy plugin enable` → the
   trackpad glyph appears in the bar.
2. Left-click it → the panel opens under the icon.
3. Flip **Natural scroll** → two-finger scrolling reverses immediately;
   `hyprctl getoption -j input:touchpad:natural_scroll` shows the new value;
   `~/.config/omarchy/magic-trackpad.json` gains `"naturalScroll"`.
4. Change **Scroll speed** to Fast → scrolling is noticeably quicker.
5. `hyprctl reload` → settings stick.
6. `omarchy plugin disable andrewmp1.magic-trackpad` → glyph gone;
   `omarchy plugin enable …` → it comes back with your settings intact.
7. `omarchy restart shell` → panel still shows your values; bar glyph is lit.
8. Log out and back in → settings still applied (the loader line in
   `hyprland.lua` did its job).
9. Keyboard: open panel, `j`/`k` move, `Enter` toggles, `Esc` closes.
10. `omarchy plugin remove andrewmp1.magic-trackpad` then delete the two
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

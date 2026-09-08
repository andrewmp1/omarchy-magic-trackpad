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
  fixtures (a mouse+touchpad mix, and the no-signal fallback), device-name
  rejection (anchored allow-list, refuse-not-repair), and `deviceUniq` /
  `deviceTransport` / `batteryFromUevent` / `isPowerSupplyName` on fixtures
  incl. junk and an oversized `uevent`
- the scope cascade: `effectiveToggle` / `effectiveScroll` / `effectivePointer`
  / `effectiveEnum` resolve device → global → live in that order
- the exact `hl.config` / `hl.device` strings and the batched apply plan
  (Global only → 1 eval; Global + a device → `hl.config` then `hl.device`;
  `input`-level keys nested beside the `touchpad` table; `enabled: false`
  short-circuits a device; `applyPlanForDevice` slices one device out)
- the generated `~/.config/hypr/omarchy-magic-trackpad.lua` **parses as Lua**
  for every shape incl. per-device blocks (a syntax error there would break
  the user's whole Hyprland config)
- the one-line loader edit to `hyprland.lua` is idempotent and still valid Lua
- `BarWidget.qml` `moduleName` == manifest `id`; README/AGENTS mention it
  (guards the "rename the handle everywhere" footgun)

**4 — Hyprland contract (the API-drift tripwire):**
For every touchpad toggle + scroll + pointer speed + each `ENUM_SETTINGS`
value, it reads the current value, applies it with the plugin's *own*
command (`hyprctl eval "hl.config{…}"`), asserts `hyprctl getoption`
changed, and restores. This is the layer that caught `hyprctl keyword`
being rejected by Omarchy's Lua parser, and that `sensitivity` is an
`input`-level key. If a future Hyprland renames an option or changes
`eval`, these go red. It also fires `hl.device({ name = <a detected
touchpad> })` and asserts `ok` (per-device has no `getoption` read-back to
verify against), restoring the device afterward — skipped when no touchpad
is present.

**5 — shell smoke (no GUI tools):**
Reloads the plugin into the running `omarchy-shell`, opens the panel over
IPC, and greps the journal for a QML `TypeError` / `ReferenceError` from our
files. Catches a Repeater delegate that leaves `modelData` undefined, a
renamed `qs.Ui` component, a duplicate `Component.onCompleted` — all of which
render nothing and only show up in the log.

**6 — panel e2e (synthetic keystrokes → real effects):**
Opens the panel, drives the keyboard-cursor with `wtype` (Wayland
virtual-keyboard protocol — no daemon, no root), and asserts the real
outcome. Every cursor index comes from **`tests/navindex.js`** — a mirror
of `BarWidget.navItems` — so adding a row never breaks the offsets; `nav`
also takes the item count and walks the wrapping cursor list whichever way
is shorter (a long one-way `wtype` run is where the panel drops focus), and
tracks its position in `$CUR`.
- Tap to click → `.global.touchpad.tapToClick` written + the option flips
- Natural scroll, scroll speed, **pointer speed** (`input:sensitivity`) —
  each flips its live value and writes the document
- after `hyprctl reload`, `scroll_factor` **persists** (managed `.lua`)
- **per-device** (a touchpad detected): `activate` the SCOPE row → device
  scope; override natural scroll → `.devices["<slug>"]` + an `hl.device(`
  block; **disable** the pad (through the confirm dialog) → `enabled: false`
  + `hl.device({…, enabled = false})`; **re-enable** → the override clears.
  Tests 5 + 6 run in one continuous panel session (reopening per step made
  the first scope-switch keystroke flaky).

It restores every value it touched on exit (including re-enabling the pad).
Off-desktop or without `wtype` it skips (exit 0); set `E2E_STRICT=1` to make
"panel didn't receive keys" a failure. The very first keystroke batch after
a fresh shell occasionally doesn't route — it soft-skips and passes on a
warm retry.

## Manual checklist (do this before tagging a release)

1. `omarchy plugin add …` (or symlink) → `omarchy plugin enable` → the
   trackpad glyph appears in the bar.
2. Left-click it → the panel opens under the icon.
3. Flip **Natural scroll** → two-finger scrolling reverses immediately;
   `hyprctl getoption -j input:touchpad:natural_scroll` shows the new value;
   `~/.config/omarchy/magic-trackpad.json` gains `"naturalScroll"`.
4. Change **Scroll speed** to Fast → scrolling is noticeably quicker.
   **Pointer speed** to Fastest → the cursor moves noticeably faster
   (`hyprctl getoption -j input:sensitivity` moves). **Scroll method** to
   Edge → scrolling only works along the right edge.
5. **Per-device** (needs an external touchpad, e.g. a Magic Trackpad):
   - The **Scope** picker shows **Global** + the pad; the header shows the
     pad's transport and battery (`… · BLUETOOTH · 69%`). Pick the pad.
   - Rows read "Inherited from Global" until changed. Flip **Natural scroll**
     off → only *that* pad reverses; the built-in pad is unchanged.
     `~/.config/omarchy/magic-trackpad.json` gains `devices["<slug>"]`; the
     managed `.lua` gains `hl.device({ name = "<slug>", natural_scroll = … })`.
   - **Disable this touchpad** → confirm → the pad stops responding, the
     settings dim, the header reads "disabled", the `.lua` has
     `enabled = false`. Toggle it back → the pad works again and the override
     is gone.
   - **Reset <pad> to Global** → confirm → the pad's overrides clear and it
     tracks Global again.
   - `hyprctl reload` and `omarchy restart shell` → the override persists.
   - Unplug the pad → the Scope picker drops it and the panel falls back to
     Global. Plug it back in while the panel is open → its overrides re-apply.
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

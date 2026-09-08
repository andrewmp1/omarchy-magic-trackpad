# Changelog

## 0.1.0 — unreleased

First release. Level 1: the libinput touchpad options Hyprland already
exposes, driven from a bar-widget popup.

- Toggles: tap-to-click, two-finger right-click, natural scroll,
  disable-while-typing, tap-and-drag, middle-click emulation.
- Scroll speed: Slow / Normal / Fast (`scroll_factor` 0.2 / 0.4 / 0.8).
- Applied live with `hyprctl eval "hl.config{…}"`; persisted to
  `~/.config/hypr/omarchy-magic-trackpad.lua` via one guarded loader line in
  `hyprland.lua`. Fully reversible.
- Reads Hyprland's current value for options you haven't set; only writes the
  ones you change.
- Keyboard-navigable panel (`j`/`k`, `Enter`, `Esc`).
- Six-layer test suite (`scripts/check.sh`): unit, manifest, generated-Lua
  syntax, live Hyprland contract, shell smoke, synthetic-keystroke e2e.

Finger-swipe gestures were prototyped and cut from this release — a runtime
`hl.gesture` can't be cleanly un-registered yet. Kept in
`Model.PLANNED_GESTURES` for v0.2.

# Magic Trackpad — Omarchy bar widget

Trackpad behaviour and finger-swipe gestures, from the Omarchy bar.

Built and tested against **Omarchy 4.0.2** / **Hyprland 0.56.2** / **Quickshell 0.3.1**.

<!-- preview.png goes here once the widget is running -->

## What it does (v0.1 — "Level 1")

Everything here is a plain **libinput / Hyprland** setting. The widget reads
the current value, lets you flip it from a popup, applies it live with
`hyprctl keyword`, and writes it to a managed file so it survives a restart.
**No daemon, no root, no device access.**

**Touchpad**
- Tap to click
- Two-finger right-click (`clickfinger_behavior`)
- Natural scroll
- Disable while typing
- Tap and drag
- Middle-click emulation
- Scroll speed — Slow / Normal / Fast (`scroll_factor` 0.2 / 0.4 / 0.8)

**Finger swipes**
- Swipe to switch workspace — on/off, 3 or 4 fingers (Hyprland `gesture`)

Left-click the bar icon for the panel. Inside: `j`/`k` or arrows move the
cursor, `Enter`/`Space` activates, `Esc` closes; mouse works too.

## Not in v0.1 (planned)

- **Apple Magic Trackpad Taptic Engine strength** (Off / Low / Medium / High)
  and click recovery — needs the `magic-haptic` backend (vendored in `bin/`)
  plus a one-time udev rule (`setup.sh`).
- **Custom gestures** (finger-count → button, force-press, corner taps) —
  needs a small opt-in userspace daemon (host-click mode + `uinput`).

## Install

```sh
omarchy plugin add https://github.com/andrewmp1/omarchy-magic-trackpad.git --enable --yes
omarchy bar move andrewmp1.magic-trackpad --section right   # optional placement
```

Plugins land disabled for review; `--enable` opts in. Code runs unsandboxed
inside `omarchy-shell` — read it first.

### From a local checkout (development)

```sh
ln -s "$PWD" ~/.config/omarchy/plugins/andrewmp1.magic-trackpad
omarchy-shell shell rescanPlugins
omarchy plugin enable andrewmp1.magic-trackpad
omarchy restart shell        # needed after construction-time changes
```

## What it writes

| Path | Purpose |
|---|---|
| `~/.config/omarchy/magic-trackpad.json` | your settings (source of truth; delete to reset) |
| `~/.config/hypr/omarchy-magic-trackpad.lua` | generated — re-applies the settings on every Hyprland load |
| `~/.config/hypr/hyprland.lua` | one guarded loader line appended (`-- omarchy-magic-trackpad`) |

To fully remove: `omarchy plugin remove andrewmp1.magic-trackpad`, then delete
the three items above (the loader line is a single `pcall(dofile, …)`).

## Uninstall

```sh
omarchy plugin remove andrewmp1.magic-trackpad --yes
rm -f ~/.config/hypr/omarchy-magic-trackpad.lua ~/.config/omarchy/magic-trackpad.json
# then remove the `-- omarchy-magic-trackpad` line from ~/.config/hypr/hyprland.lua
```

## License

MIT © 2026 Drew Purdy. `bin/magic-haptic` is from the
[magic-trackpad-haptics](https://github.com/andrewmp1/magic-trackpad-haptics)
research repo, vendored for the planned haptics phase.

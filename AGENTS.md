# Repository guidance

An Omarchy shell bar-widget plugin. Quickshell/QML front end, `hyprctl` back
end. See `docs/omarchy-plugin-plan.md` and `docs/omarchy-plugin-panel-mockup.html`
in the sibling `magic-trackpad-haptics` repo for the full design.

## What lives where

| File | Role |
| --- | --- |
| `Model.js` | All pure logic: the setting catalogue, `hyprctl getoption` parsing, the apply plan, the generated Lua, the loader-line guard. No QML imports — `node --test tests/model.test.js` runs it directly. |
| `ConfigStore.qml` | `~/.config/omarchy/magic-trackpad.json` on disk + in memory, normalized on every read. Source of truth. |
| `HyprSync.qml` | Config → live Hyprland (`hyprctl keyword`), the read-back (`hyprctl getoption`), and the managed `~/.config/hypr/omarchy-magic-trackpad.lua` + one guarded `dofile` loader line in `hyprland.lua`. |
| `Panel.qml` | The bar button + popup. Entry point (`entryPoints.barWidget`). Owns its own store + sync; assumes no `Service.qml` is running. |
| `bin/magic-haptic` | Vendored from the research repo. Backend for the **planned** haptics phase; unused in v0.1. |
| `setup.sh` | One-time udev rule for the **planned** haptics phase. Not needed for v0.1. |

## Scope: three phases

1. **v0.1 — Level 1 (this).** libinput touchpad options + Hyprland finger
   swipes. No daemon, no permissions.
2. **Haptics.** Apple Magic Trackpad Taptic Engine strength via `magic-haptic`
   + a udev `input`-group perms rule (`setup.sh`). Adds a "Haptics" section
   and a per-unit picker.
3. **Custom gestures.** Opt-in userspace daemon: host-click mode (`0x21=1`) +
   raw multitouch → `uinput`. Finger-count buttons, force-press, corner taps.

## Things that will bite you (from building Omarchy plugins)

- **`hyprctl getoption` has no gesture read-back.** `gestures:*` options don't
  exist in Hyprland 0.51+. Finger swipes are registered with the `gesture`
  keyword and can't be un-registered at runtime — disabling one runs
  `hyprctl reload` after regenerating the managed Lua (which no longer emits
  it).
- **The config document is the source of truth, not Hyprland.** `getoption`
  is only read to *show* the state of an option the user hasn't set yet
  (`Model.effectiveToggle`). Once set, the JSON wins.
- **`\uXXXX` in QML is exactly 4 hex digits.** Paste literal glyphs. The bar
  icon here is drawn with `Rectangle`s to avoid Nerd Font guesswork.
- **`omarchy-shell shell rescanPlugins` reloads code but may not
  re-instantiate a live bar widget.** Use `omarchy restart shell` when
  testing anything at construction time.
- **A `FileView` on a path that doesn't exist yet can emit neither `onLoaded`
  nor `onLoadFailed`.** `ConfigStore` has a 500ms fallback timer.
- **Two handlers for one property (e.g. a second `Component.onCompleted`) is a
  fatal load error.** `qmllint` still exits 0.
- **`qmllint` can't resolve `qs.Commons` / `qs.Ui` outside Quickshell.** The
  `Panel -> Panel` inheritance-cycle and unqualified-`bar`/`Color` warnings
  are false positives that first-party plugins produce too. Read the output
  for real syntax errors only.

## Validation

```sh
node --test tests/model.test.js
/usr/lib/qt6/bin/qmllint -I /usr/share/omarchy/shell *.qml   # expect qs.* import noise
omarchy plugin validate .
```

## Manual check

```sh
ln -sfn "$PWD" ~/.config/omarchy/plugins/andrewmp1.magic-trackpad
omarchy restart shell
omarchy plugin enable andrewmp1.magic-trackpad
# open the panel, flip "Natural scroll", then:
hyprctl getoption -j input:touchpad:natural_scroll        # bool flips
cat ~/.config/hypr/omarchy-magic-trackpad.lua             # hl.keyword line present
grep omarchy-magic-trackpad ~/.config/hypr/hyprland.lua   # loader line present
```

## Plugin id / author handle

`andrewmp1.magic-trackpad` — the `andrewmp1` prefix is the GitHub handle and
appears in the manifest `id`, the install path, and every `moduleName` /
`ipcTarget`. Change all of them together if the handle is different.

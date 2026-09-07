# Repository guidance

An Omarchy shell bar-widget plugin. Quickshell/QML front end, `hyprctl` back
end. See `docs/omarchy-plugin-plan.md` and `docs/omarchy-plugin-panel-mockup.html`
in the sibling `magic-trackpad-haptics` repo for the full design.

## What lives where

| File | Role |
| --- | --- |
| `Model.js` | All pure logic: the setting catalogue, `hyprctl getoption` parsing, the apply plan, the generated Lua, the loader-line guard. No QML imports — `node --test tests/model.test.js` runs it directly. |
| `ConfigStore.qml` | `~/.config/omarchy/magic-trackpad.json` on disk + in memory, normalized on every read. Source of truth. |
| `HyprSync.qml` | Config → live Hyprland (`hyprctl eval "hl.config{...}"`), the read-back (`hyprctl getoption -j`), and the managed `~/.config/hypr/omarchy-magic-trackpad.lua` + one guarded `dofile` loader line in `hyprland.lua`. |
| `Panel.qml` | The bar button + popup. Entry point (`entryPoints.barWidget`). Owns its own store + sync; assumes no `Service.qml` is running. |
| `bin/magic-haptic` | Vendored from the research repo. Backend for the **planned** haptics phase; unused in v0.1. |
| `setup.sh` | One-time udev rule for the **planned** haptics phase. Not needed for v0.1. |

## Scope: three phases

1. **v0.1 — Level 1 (this).** libinput touchpad options only. No daemon, no
   permissions. Finger swipes were cut before release — see the gesture note
   below.
2. **Haptics.** Apple Magic Trackpad Taptic Engine strength via `magic-haptic`
   + a udev `input`-group perms rule (`setup.sh`). Adds a "Haptics" section
   and a per-unit picker.
3. **Custom gestures.** Opt-in userspace daemon: host-click mode (`0x21=1`) +
   raw multitouch → `uinput`. Finger-count buttons, force-press, corner taps.

## Things that will bite you (from building Omarchy plugins)

- **Runtime config goes through `hyprctl eval "hl.config{...}"`, never
  `hyprctl keyword`.** Omarchy runs Hyprland's Lua parser, which rejects
  `keyword` outright ("can't work with non-legacy parsers. Use eval."). Reads
  still use `hyprctl getoption -j` (works with either parser); option names
  are the underscore form (`input:touchpad:tap_to_click`), which both accept.
- **Gestures are cut from v0.1.** A runtime `hl.gesture(...)` is sticky —
  `hyprctl reload` does NOT remove it, only a full Hyprland restart does — and
  it errors ("overshadowed") if a gesture for that direction already exists,
  including one the user set in their own `input.lua`. `Model.PLANNED_GESTURES`
  holds the catalogue for a v0.2 that solves register/unregister.
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
- **`qmllint` can't resolve `qs.Commons` / `qs.Ui` outside Quickshell.**
  `scripts/check.sh` silences the categories that fire only because of that
  (`--import`, `--unresolved-type`, `--unqualified`, ...); a lone
  `Panel -> Panel` inheritance-cycle line remains and is expected — first-party
  plugins produce it too.

## Validation

```sh
bash scripts/check.sh        # runs all four layers; exits non-zero on a real failure
```

Layers:
1. `node --test tests/model.test.js tests/manifest.test.js tests/lua.test.js`
   — pure logic, manifest/id consistency, generated-Lua parses under `luac`.
2. `omarchy plugin validate .` — manifest schema.
3. `qmllint` (informational) — with the `qs.*`-unresolvable categories
   silenced; a lone `Panel -> Panel` line is expected.
4. `node --test tests/hypr-contract.test.js` — live Hyprland; each setting is
   applied with the plugin's own command, asserted, then restored.
5. `tests/smoke.sh` — plugin loads into the running shell and the panel opens
   with no QML `TypeError` in the journal.
6. `tests/e2e.sh` — `wtype` drives the panel's keyboard cursor; asserts the
   real Hyprland option + JSON document + persistence across `hyprctl reload`.

Layers 4-6 skip off-desktop. `.github/workflows/ci.yml` runs 1-3 on push/PR.
Full menu + a manual checklist: `docs/TESTING.md`.

## Manual check

```sh
ln -sfn "$PWD" ~/.config/omarchy/plugins/andrewmp1.magic-trackpad
omarchy restart shell
omarchy plugin enable andrewmp1.magic-trackpad
# open the panel, flip "Natural scroll", then:
hyprctl getoption -j input:touchpad:natural_scroll        # bool flips
cat ~/.config/hypr/omarchy-magic-trackpad.lua             # hl.config line present
grep omarchy-magic-trackpad ~/.config/hypr/hyprland.lua   # loader line present
```

## Plugin id / author handle

`andrewmp1.magic-trackpad` — the `andrewmp1` prefix is the GitHub handle and
appears in the manifest `id`, the install path, and every `moduleName` /
`ipcTarget`. Change all of them together if the handle is different.

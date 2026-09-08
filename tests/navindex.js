// Mirror of BarWidget.qml's `navItems` ordering, so tests/e2e.sh can compute
// a keyboard-cursor index by name instead of hard-coding magic offsets that
// break every time a row is added.
//
// KEEP IN SYNC with BarWidget.qml `navItems`. The e2e suite exercises the
// real panel, so a drift here shows up as an e2e failure.
//
//   node tests/navindex.js <hasScopeRow 0|1> <deviceScope 0|1> <kind> [key]
//     kind: scope | toggle | enum | scroll | pointer | disable | reset | count
//     key:  a TOUCHPAD_TOGGLES key (kind=toggle) or ENUM_SETTINGS key (kind=enum)
//   prints the 0-based index (or the item count for kind=count), -1 if absent.

const M = require("../Model.js")

function enumsInSection(section) {
  return M.ENUM_SETTINGS.filter(function (e) { return e.section === section })
}

// deviceScope: the panel is scoped to a device (adds "disable").
// deviceOverrides: that device has overrides (adds "reset").
// disabled: that device is turned off (only scope/disable/reset are navigable).
function navItems(hasScope, deviceScope, deviceOverrides, disabled) {
  const items = []
  if (hasScope) items.push({ kind: "scope" })
  if (deviceScope && disabled) {
    items.push({ kind: "disable" })
    items.push({ kind: "reset" })
    return items
  }
  for (const t of M.TOUCHPAD_TOGGLES) items.push({ kind: "toggle", key: t.key })
  for (const e of enumsInSection("touchpad")) items.push({ kind: "enum", setting: e.key })
  items.push({ kind: "scroll" })
  for (const e of enumsInSection("scroll")) items.push({ kind: "enum", setting: e.key })
  items.push({ kind: "pointer" })
  for (const e of enumsInSection("pointer")) items.push({ kind: "enum", setting: e.key })
  if (deviceScope) items.push({ kind: "disable" })
  if (deviceScope && deviceOverrides) items.push({ kind: "reset" })
  return items
}

if (require.main === module) {
  // node navindex.js <hasScope> <deviceScope> <hasOverrides> <kind> [key]
  const [hasScope, deviceScope, hasOverrides, kind, key] = process.argv.slice(2)
  const items = navItems(hasScope === "1", deviceScope === "1", hasOverrides === "1", false)
  if (kind === "count") {
    process.stdout.write(String(items.length))
  } else {
    const idx = items.findIndex(function (it) {
      if (it.kind !== kind) return false
      if (key === undefined) return true
      return it.key === key || it.setting === key
    })
    process.stdout.write(String(idx))
  }
}

module.exports = { navItems }

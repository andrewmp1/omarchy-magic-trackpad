// Mirror of BarWidget.qml's `navItems` ordering, so tests/e2e.sh can compute
// a keyboard-cursor index by name instead of hard-coding magic offsets that
// break every time a row is added.
//
// KEEP IN SYNC with BarWidget.qml `navItems`. The e2e suite exercises the
// real panel, so a drift here shows up as an e2e failure.
//
//   node tests/navindex.js <hasScopeRow 0|1> <kind> [key]
//     kind: scope | toggle | enum | scroll | pointer | reset
//     key:  a TOUCHPAD_TOGGLES key (for kind=toggle) or an ENUM_SETTINGS key
//           (for kind=enum)
//   prints the 0-based index, or -1 if not present.

const M = require("../Model.js")

function enumsInSection(section) {
  return M.ENUM_SETTINGS.filter(function (e) { return e.section === section })
}

function navItems(hasScope, deviceOverrides) {
  const items = []
  if (hasScope) items.push({ kind: "scope" })
  for (const t of M.TOUCHPAD_TOGGLES) items.push({ kind: "toggle", key: t.key })
  for (const e of enumsInSection("touchpad")) items.push({ kind: "enum", setting: e.key })
  items.push({ kind: "scroll" })
  for (const e of enumsInSection("scroll")) items.push({ kind: "enum", setting: e.key })
  items.push({ kind: "pointer" })
  for (const e of enumsInSection("pointer")) items.push({ kind: "enum", setting: e.key })
  if (deviceOverrides) items.push({ kind: "reset" })
  return items
}

if (require.main === module) {
  const [hasScope, kind, key] = process.argv.slice(2)
  const items = navItems(hasScope === "1", false)
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

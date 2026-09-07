// The plugin writes a Lua file that Hyprland sources on every config load.
// A syntax error there breaks the user's whole Hyprland config, so parse-
// check every shape `generateLua` / `withLoader` can emit.
//
// Needs `luac` (any 5.x). If it's absent these tests are skipped rather than
// failed — CI installs lua5.4 so the gate still runs there.

const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const M = require("../Model.js")

function luacBin() {
  for (const b of ["luac", "luac5.4", "luac5.3", "luac5.1"]) {
    try { execFileSync(b, ["-v"], { stdio: "ignore" }); return b } catch (e) { /* next */ }
  }
  return null
}
const LUAC = luacBin()
const opts = { skip: LUAC ? false : "luac not installed" }

function parses(src) {
  const f = path.join(os.tmpdir(), `mtp-${process.pid}-${Math.random().toString(36).slice(2)}.lua`)
  fs.writeFileSync(f, src)
  try {
    execFileSync(LUAC, ["-p", f], { encoding: "utf8" })
    return { ok: true }
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) }
  } finally {
    fs.rmSync(f, { force: true })
  }
}

const SHAPES = {
  "default (no-op stub)": M.defaultConfig(),
  "one toggle": { touchpad: { naturalScroll: false } },
  "all toggles + scroll": {
    touchpad: {
      tapToClick: true, twoFingerRight: false, naturalScroll: true,
      disableWhileTyping: true, tapAndDrag: false, middleClickPaste: true
    },
    scrollSpeed: "fast"
  },
  "stale gesture key is ignored": {
    touchpad: { tapToClick: true },
    gestures: { workspaceSwipe: { enabled: true, fingers: 3 } }
  }
}

for (const [label, cfg] of Object.entries(SHAPES)) {
  test(`generateLua parses as Lua — ${label}`, opts, () => {
    const r = parses(M.generateLua(cfg))
    assert.ok(r.ok, r.err)
  })
}

test("withLoader keeps hyprland.lua valid Lua", opts, () => {
  const existing = '-- user hyprland.lua\nlocal x = 1\nhl.config({ general = { gaps_in = 4 } })\n'
  const r = parses(M.withLoader(existing))
  assert.ok(r.ok, r.err)
  // and again after a second application (idempotent + still valid)
  const r2 = parses(M.withLoader(M.withLoader(existing)))
  assert.ok(r2.ok, r2.err)
})

const test = require("node:test")
const assert = require("node:assert/strict")
const M = require("../Model.js")

test("defaultConfig inherits everything (nulls) and gestures off", () => {
  const c = M.defaultConfig()
  assert.equal(c.version, 1)
  assert.equal(c.scrollSpeed, null)
  for (const t of M.TOUCHPAD_TOGGLES) assert.equal(c.touchpad[t.key], null)
  for (const g of M.GESTURES) {
    assert.equal(c.gestures[g.key].enabled, false)
    assert.equal(c.gestures[g.key].fingers, g.defaultFingers)
  }
})

test("normalizeConfig repairs junk", () => {
  const c = M.normalizeConfig({
    touchpad: { tapToClick: "yes", naturalScroll: true },
    scrollSpeed: "warp",
    gestures: { workspaceSwipe: { enabled: 1, fingers: 9 } }
  })
  assert.equal(c.touchpad.tapToClick, null) // "yes" is not a boolean
  assert.equal(c.touchpad.naturalScroll, true)
  assert.equal(c.scrollSpeed, null) // unknown stop -> inherit
  assert.equal(c.gestures.workspaceSwipe.enabled, false) // 1 is not === true
  assert.equal(c.gestures.workspaceSwipe.fingers, 3) // 9 not in [3,4]
})

test("parseGetOption reads bool/int/float/str and unset", () => {
  assert.equal(M.parseGetOption('{"bool": true, "set": true}'), true)
  assert.equal(M.parseGetOption('{"int": 2}'), 2)
  assert.equal(M.parseGetOption('{"float": 0.4}'), 0.4)
  assert.equal(M.parseGetOption('{"str": "x"}'), "x")
  assert.equal(M.parseGetOption("no such option"), null)
  assert.equal(M.parseGetOption(""), null)
})

test("applyPlan emits only set toggles / scroll / enabled gestures", () => {
  const plan = M.applyPlan({
    touchpad: { tapToClick: true, twoFingerRight: false },
    scrollSpeed: "fast",
    gestures: { workspaceSwipe: { enabled: true, fingers: 4 } }
  })
  const flat = plan.map((a) => a.join(" "))
  assert.ok(flat.includes("hyprctl keyword input:touchpad:tap-to-click true"))
  assert.ok(flat.includes("hyprctl keyword input:touchpad:clickfinger_behavior false"))
  assert.ok(flat.some((l) => l.startsWith("hyprctl keyword input:touchpad:scroll_factor 0.8")))
  assert.ok(flat.includes("hyprctl keyword gesture 4, horizontal, workspace"))
  assert.ok(!flat.some((l) => l.includes("natural_scroll"))) // never set

  // Nothing set anywhere -> empty plan (inherit everything).
  assert.equal(M.applyPlan({}).length, 0)
})

test("loader line is idempotent and marker-guarded", () => {
  const empty = ""
  const once = M.withLoader(empty)
  assert.ok(once.includes("omarchy-magic-trackpad"))
  assert.equal(M.needsLoader(once), false)
  assert.equal(M.withLoader(once), once) // second call is a no-op
})

test("generateLua emits hl.keyword for set toggles and hl.gesture when enabled", () => {
  const lua = M.generateLua({
    touchpad: { tapToClick: true },
    scrollSpeed: "slow",
    gestures: { workspaceSwipe: { enabled: true, fingers: 3 } }
  })
  assert.ok(lua.includes('hl.keyword("input:touchpad:tap-to-click", "true")'))
  assert.ok(lua.includes('hl.keyword("input:touchpad:scroll_factor", "0.2")'))
  assert.ok(lua.includes('fingers = 3, direction = "horizontal", action = "workspace"'))
  assert.ok(!lua.includes("natural_scroll"))

  // Default config -> a guarded stub that touches nothing.
  const stub = M.generateLua(M.defaultConfig())
  assert.ok(!stub.includes("hl.keyword"))
  assert.ok(!stub.includes("hl.gesture"))
})

test("summaryLine reads back the enabled bits", () => {
  assert.equal(M.summaryLine({}), "defaults")
  assert.equal(
    M.summaryLine({ touchpad: { tapToClick: true, naturalScroll: true }, gestures: { workspaceSwipe: { enabled: true, fingers: 3 } } }),
    "tap · natural scroll · swipe"
  )
})

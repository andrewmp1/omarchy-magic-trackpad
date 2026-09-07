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

test("configLua builds an hl.config nested table", () => {
  assert.equal(
    M.configLua({ natural_scroll: false }),
    "hl.config({ input = { touchpad = { natural_scroll = false } } })"
  )
  const a = M.configEvalArgs({ scroll_factor: 0.8 })
  assert.deepEqual(a, ["hyprctl", "eval", "hl.config({ input = { touchpad = { scroll_factor = 0.8 } } })"])
  assert.deepEqual(
    M.toggleEvalArgs("tap_to_click", true),
    ["hyprctl", "eval", "hl.config({ input = { touchpad = { tap_to_click = true } } })"]
  )
})

test("gestureLua / gestureEvalArgs", () => {
  assert.equal(
    M.gestureLua(4, "horizontal", "workspace"),
    'hl.gesture({ fingers = 4, direction = "horizontal", action = "workspace" })'
  )
  assert.equal(M.gestureEvalArgs(3, "horizontal", "workspace")[1], "eval")
})

test("applyPlan batches touchpad+scroll into one eval, gestures separate", () => {
  const plan = M.applyPlan({
    touchpad: { tapToClick: true, twoFingerRight: false },
    scrollSpeed: "fast",
    gestures: { workspaceSwipe: { enabled: true, fingers: 4 } }
  })
  assert.equal(plan.length, 2)
  assert.ok(plan[0][2].includes("tap_to_click = true"))
  assert.ok(plan[0][2].includes("clickfinger_behavior = false"))
  assert.ok(plan[0][2].includes("scroll_factor = 0.8"))
  assert.ok(plan[1][2].includes("fingers = 4"))

  assert.equal(M.applyPlan({}).length, 0) // nothing set -> inherit everything
})

test("loader line is idempotent and marker-guarded", () => {
  const once = M.withLoader("")
  assert.ok(once.includes("omarchy-magic-trackpad"))
  assert.ok(once.includes("pcall(dofile"))
  assert.equal(M.needsLoader(once), false)
  assert.equal(M.withLoader(once), once) // second call is a no-op
})

test("generateLua emits hl.config / hl.gesture; default is a no-op stub", () => {
  const lua = M.generateLua({
    touchpad: { tapToClick: true },
    scrollSpeed: "slow",
    gestures: { workspaceSwipe: { enabled: true, fingers: 3 } }
  })
  assert.ok(lua.includes("hl.config({ input = { touchpad = { tap_to_click = true, scroll_factor = 0.2 } } })"))
  assert.ok(lua.includes('hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })'))
  assert.ok(!lua.includes("natural_scroll"))

  const stub = M.generateLua(M.defaultConfig())
  assert.ok(!stub.includes("hl.config"))
  assert.ok(!stub.includes("hl.gesture"))
  assert.ok(stub.includes('if type(hl) ~= "table" then return end'))
})

test("effectiveToggle / effectiveScroll fall back to live only when unset", () => {
  assert.equal(M.effectiveToggle({}, { naturalScroll: true }, "naturalScroll"), true)
  assert.equal(M.effectiveToggle({ touchpad: { naturalScroll: false } }, { naturalScroll: true }, "naturalScroll"), false)
  assert.equal(M.effectiveScroll({}, { scrollSpeed: "fast" }), "fast")
  assert.equal(M.effectiveScroll({ scrollSpeed: "slow" }, { scrollSpeed: "fast" }), "slow")
})

test("summaryLine reads back the enabled bits", () => {
  assert.equal(M.summaryLine({}), "defaults")
  assert.equal(
    M.summaryLine({ touchpad: { tapToClick: true, naturalScroll: true }, gestures: { workspaceSwipe: { enabled: true, fingers: 3 } } }),
    "tap · natural scroll · swipe"
  )
})

const test = require("node:test")
const assert = require("node:assert/strict")
const M = require("../Model.js")

test("defaultConfig inherits everything (all nulls)", () => {
  const c = M.defaultConfig()
  assert.equal(c.version, 1)
  assert.equal(c.scrollSpeed, null)
  for (const t of M.TOUCHPAD_TOGGLES) assert.equal(c.touchpad[t.key], null)
  assert.deepEqual(c.gestures, {}) // gestures deferred to v0.2
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
  assert.deepEqual(c.gestures, {}) // gesture keys are ignored in v0.1
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

test("applyPlan batches touchpad + scroll into a single hl.config eval", () => {
  const plan = M.applyPlan({
    touchpad: { tapToClick: true, twoFingerRight: false },
    scrollSpeed: "fast"
  })
  assert.equal(plan.length, 1)
  assert.ok(plan[0][2].includes("tap_to_click = true"))
  assert.ok(plan[0][2].includes("clickfinger_behavior = false"))
  assert.ok(plan[0][2].includes("scroll_factor = 0.8"))

  assert.equal(M.applyPlan({}).length, 0) // nothing set -> inherit everything
})

test("finger-swipe gestures are deferred to v0.2 (not wired in v0.1)", () => {
  assert.equal(M.GESTURES.length, 0)
  assert.ok(M.PLANNED_GESTURES.length > 0)
  // a stale JSON with a gesture enabled produces no gesture output
  const lua = M.generateLua({ gestures: { workspaceSwipe: { enabled: true, fingers: 3 } } })
  assert.ok(!lua.includes("hl.gesture"))
  assert.equal(M.applyPlan({ gestures: { workspaceSwipe: { enabled: true, fingers: 3 } } }).length, 0)
})

test("loader line is idempotent and marker-guarded", () => {
  const once = M.withLoader("")
  assert.ok(once.includes("omarchy-magic-trackpad"))
  assert.ok(once.includes("pcall(dofile"))
  assert.equal(M.needsLoader(once), false)
  assert.equal(M.withLoader(once), once) // second call is a no-op
})

test("generateLua emits one hl.config; default is a no-op stub", () => {
  const lua = M.generateLua({ touchpad: { tapToClick: true }, scrollSpeed: "slow" })
  assert.ok(lua.includes("hl.config({ input = { touchpad = { tap_to_click = true, scroll_factor = 0.2 } } })"))
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
    M.summaryLine({ touchpad: { tapToClick: true, naturalScroll: true } }),
    "tap · natural scroll"
  )
})

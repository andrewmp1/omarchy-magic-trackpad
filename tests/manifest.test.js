const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))

test("manifest.json is well-formed for the Omarchy plugin schema", () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/, "id must look like <handle>.<name>")
  assert.ok(typeof manifest.name === "string" && manifest.name.length > 0)
  assert.ok(typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version))
  assert.ok(Array.isArray(manifest.kinds) && manifest.kinds.includes("bar-widget"))
  assert.ok(manifest.entryPoints && typeof manifest.entryPoints.barWidget === "string")
  assert.ok(manifest.barWidget && typeof manifest.barWidget.displayName === "string")
})

test("every declared entry-point file exists", () => {
  for (const rel of Object.values(manifest.entryPoints)) {
    assert.ok(fs.existsSync(path.join(root, rel)), `entry point file is missing: ${rel}`)
  }
})

test("Panel.qml moduleName / ipcTarget stay in step with the manifest id", () => {
  const qml = fs.readFileSync(path.join(root, "Panel.qml"), "utf8")
  assert.ok(qml.includes(`moduleName: "${manifest.id}"`),
    `Panel.qml must declare moduleName: "${manifest.id}" (change the handle in ALL places together)`)
})

test("README + AGENTS reference the same plugin id", () => {
  for (const f of ["README.md", "AGENTS.md"]) {
    const txt = fs.readFileSync(path.join(root, f), "utf8")
    assert.ok(txt.includes(manifest.id), `${f} does not mention ${manifest.id}`)
  }
})

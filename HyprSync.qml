import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Config document -> live Hyprland + a managed file that survives a restart.
//
//   refresh()         re-reads the current touchpad option values into
//                     `liveValues` (used to show state the user hasn't set).
//   applyLive(cfg)     runs the apply plan now.
//   runOne(argv)       queues one `hyprctl` invocation.
//   writeManaged(cfg)  regenerates ~/.config/hypr/omarchy-magic-trackpad.lua
//                      and installs the guarded loader line in hyprland.lua.
//
// Hardening: every child process is a fixed argv array (no shell to inject
// into), `hyprctl` is pinned to an absolute path, each read is capped in
// bytes before it is parsed, and every process is under a watchdog that
// TERMinates — then KILLs — anything that outlives its deadline.
//
// All of it is safe when Hyprland is not running — hyprctl just fails.
Item {
  id: root

  readonly property string home: Quickshell.env("HOME")
  readonly property string configDir: Quickshell.env("XDG_CONFIG_HOME") || (home + "/.config")
  readonly property string luaPath: configDir + "/hypr/omarchy-magic-trackpad.lua"
  readonly property string hyprlandLuaPath: configDir + "/hypr/hyprland.lua"
  readonly property string procInputPath: "/proc/bus/input/devices"

  // Byte ceilings. `hyprctl getoption -j` for one option is a few hundred
  // bytes; anything larger is refused, not truncated (cap + 1 detection).
  readonly property int optionCap: 4096
  readonly property int errorCap: 2048
  // `hyprctl devices -j` on a busy rig (tablets, several keyboards) is a few
  // KB; /proc/bus/input/devices likewise. Both are capped well above that and
  // refused, not truncated, past the ceiling.
  readonly property int devicesCap: 131072
  readonly property int termMs: 10000
  readonly property int killMs: 13000

  property string lastError: ""
  property bool loaderInstalled: false

  // key -> current bool, or "normal"/"slow"/"fast" for scrollSpeed. Read from
  // Hyprland; the config document overrides any key the user has set.
  property var liveValues: ({})

  // -------------------------------------------------------------- read-back

  // One bounded `hyprctl getoption -j` per option, run sequentially. The
  // option names come from the closed catalogue in Model.js — no user data
  // reaches an argument, and there is no shell to build one for.
  property var _refreshQueue: []
  property var _refreshJob: null
  property string _refreshRaw: ""
  property bool _refreshOverflow: false
  property var _pending: ({})

  function refresh() {
    refreshDevices()
    if (refreshProc.running) return
    var q = []
    for (var i = 0; i < Model.TOUCHPAD_TOGGLES.length; i++)
      q.push({ key: Model.TOUCHPAD_TOGGLES[i].key, option: Model.TOUCHPAD_TOGGLES[i].option })
    q.push({ key: "scrollSpeed", option: Model.SCROLL_OPTION })
    q.push({ key: "pointerSpeed", option: Model.POINTER_OPTION })
    for (var j = 0; j < Model.ENUM_SETTINGS.length; j++)
      q.push({ key: Model.ENUM_SETTINGS[j].key, option: Model.ENUM_SETTINGS[j].option })
    _refreshQueue = q
    _pending = {}
    _refreshNext()
  }

  function _refreshNext() {
    if (_refreshQueue.length === 0) return
    var job = _refreshQueue[0]
    _refreshQueue = _refreshQueue.slice(1)
    _refreshJob = job
    _refreshRaw = ""
    _refreshOverflow = false
    refreshProc.command = ["/usr/bin/hyprctl", "getoption", "-j", job.option]
    root._watchTarget = "refresh"
    watchdogTerm.restart()
    refreshProc.running = true
  }

  function _absorb(key, raw) {
    var v = Model.parseGetOption(raw)
    if (key === "scrollSpeed") {
      var best = "normal", bestD = 1e9
      for (var s = 0; s < Model.SCROLL_STOPS.length; s++) {
        var d = Math.abs(Model.SCROLL_STOPS[s].value - Number(v))
        if (isFinite(d) && d < bestD) { bestD = d; best = Model.SCROLL_STOPS[s].key }
      }
      _pending[key] = best
    } else if (key === "pointerSpeed") {
      // raw sensitivity float; effectivePointer() snaps it to a stop
      _pending[key] = isFinite(Number(v)) ? Number(v) : null
    } else if (Model.enumSetting(key)) {
      // raw Lua string; effectiveEnum() maps it back to a value key
      _pending[key] = (typeof v === "string") ? v : null
    } else {
      // bool for most, int (0/1) for drag_lock / drag_3fg
      _pending[key] = (v === true) || (typeof v === "number" && v > 0)
    }
  }

  function _refreshFinished() {
    watchdogTerm.stop()
    watchdogKill.stop()
    var key = _refreshJob ? _refreshJob.key : ""
    if (key !== "") {
      if (_refreshOverflow) {
        console.warn("magic-trackpad: getoption output exceeded", optionCap, "bytes for", key, "- refusing it")
      } else {
        _absorb(key, _refreshRaw)
      }
    }
    if (_refreshQueue.length > 0) { _refreshNext(); return }
    liveValues = _pending
  }

  Process {
    id: refreshProc

    // splitMarker: "" streams every chunk; the cap is enforced as the bytes
    // arrive, before any buffering beyond it. Overflow kills the process and
    // refuses the value instead of truncating it into shape.
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._refreshRaw.length + data.length > root.optionCap) {
          root._refreshOverflow = true
          root._refreshRaw = ""
          refreshProc.signal(15)
          return
        }
        root._refreshRaw += data
      }
    }
    stderr: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._refreshRaw.length + data.length > root.optionCap) {
          root._refreshOverflow = true
          refreshProc.signal(15)
        }
      }
    }
    onExited: root._refreshFinished()
  }

  // -------------------------------------------------------------- device list

  // `hyprctl devices -j` (pointer devices, slugified) cross-referenced with
  // /proc/bus/input/devices (BUTTONPAD / absolute-axis bits) picks out the
  // touchpads — see Model.touchpadDevices. `hyprctl devices` runs under its
  // own TERM/KILL watchdog; /proc is read through BoundedRead (nofollow,
  // nonblock, capped). Both are untrusted: a device sets its own name string,
  // so the only names that survive are the ones Model.isDeviceName accepts,
  // and the list handed to the UI is length-bounded.
  property var touchpadDevices: []

  property string _devRaw: ""
  property bool _devOverflow: false
  property bool _devExited: false
  property int _devExitCode: 1
  property string _procText: ""
  property bool _procOk: false
  property bool _procDone: false

  function refreshDevices() {
    if (devicesProc.running) return
    _devRaw = ""
    _devOverflow = false
    _devExited = false
    _devExitCode = 1
    _procText = ""
    _procOk = false
    _procDone = false
    procReader.read(root.procInputPath)
    devicesProc.command = ["/usr/bin/hyprctl", "devices", "-j"]
    devWatchdogTerm.restart()
    devicesProc.running = true
  }

  function _maybeFinishDevices() {
    if (!_devExited || !_procDone) return
    // A failed / oversized `hyprctl devices` read means no reliable list —
    // keep whatever was there rather than dropping to a bogus one.
    if (_devOverflow || _devExitCode !== 0) return
    var proc = _procOk ? _procText : ""
    var list = Model.touchpadDevices(_devRaw, proc)
    // Bound what reaches the UI regardless of what the inputs claimed.
    touchpadDevices = Array.isArray(list) ? list.slice(0, 12) : []
  }

  Process {
    id: devicesProc
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._devRaw.length + data.length > root.devicesCap) {
          root._devOverflow = true
          root._devRaw = ""
          devicesProc.signal(15)
          return
        }
        root._devRaw += data
      }
    }
    stderr: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._devRaw.length + data.length > root.devicesCap) {
          root._devOverflow = true
          devicesProc.signal(15)
        }
      }
    }
    onExited: function (exitCode, exitStatus) {
      devWatchdogTerm.stop()
      devWatchdogKill.stop()
      root._devExitCode = (exitCode === 0) ? 0 : 1
      if (root._devOverflow || exitCode !== 0)
        console.warn("magic-trackpad: `hyprctl devices` refused (",
                     root._devOverflow ? "over cap" : "exit " + exitCode, ")")
      root._devExited = true
      root._maybeFinishDevices()
    }
  }

  BoundedRead {
    id: procReader
    cap: 262144          // /proc/bus/input/devices; refuse absurd sizes
    onFinished: function (ok, overflow, absent, content) {
      root._procOk = ok
      root._procText = ok ? content : ""
      root._procDone = true
      root._maybeFinishDevices()
    }
  }

  Timer {
    id: devWatchdogTerm
    interval: root.termMs
    repeat: false
    onTriggered: {
      if (devicesProc.running) devicesProc.signal(15)
      devWatchdogKill.restart()
    }
  }
  Timer {
    id: devWatchdogKill
    interval: root.killMs - root.termMs
    repeat: false
    onTriggered: if (devicesProc.running) devicesProc.signal(9)
  }

  // ------------------------------------------------------------- device battery

  // For the selected device scope only: its transport (from the /proc block
  // this component already read) and, if a HID battery node matches its
  // `U: Uniq`, the capacity + charging status. `find` lists the one directory
  // whose name contains the uniq (argv array, no shell, uniq is validated to
  // a MAC/hex shape first); its `uevent` is then read through BoundedRead.
  // Purely informational — the panel never blocks on it.
  property string batteryTransport: ""
  property int batteryCapacity: -1
  property string batteryStatus: ""
  property string _batteryFor: ""
  property string _batteryFindRaw: ""

  function probeBattery(slug) {
    batteryTransport = Model.deviceTransport(_procText, slug)
    batteryCapacity = -1
    batteryStatus = ""
    _batteryFor = slug
    if (batteryFindProc.running) batteryFindProc.signal(15)
    var uniq = Model.deviceUniq(_procText, slug)
    if (!uniq) return
    _batteryFindRaw = ""
    batteryFindProc.command = ["/usr/bin/find", "/sys/class/power_supply", "-maxdepth", "1",
                               "-name", "*" + uniq + "*battery*", "-printf", "%f\n"]
    batteryWatchdogTerm.restart()
    batteryFindProc.running = true
  }

  Process {
    id: batteryFindProc
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._batteryFindRaw.length + data.length <= 1024) root._batteryFindRaw += data
      }
    }
    onExited: function (exitCode, exitStatus) {
      batteryWatchdogTerm.stop()
      batteryWatchdogKill.stop()
      if (exitCode !== 0) return
      var name = String(root._batteryFindRaw).split("\n")[0].trim()
      if (!Model.isPowerSupplyName(name)) return
      batteryReader.read("/sys/class/power_supply/" + name + "/uevent")
    }
  }

  BoundedRead {
    id: batteryReader
    cap: 8192
    onFinished: function (ok, overflow, absent, content) {
      if (!ok) return
      var b = Model.batteryFromUevent(content)
      root.batteryCapacity = b.capacity
      root.batteryStatus = b.status
    }
  }

  Timer {
    id: batteryWatchdogTerm
    interval: root.termMs
    repeat: false
    onTriggered: {
      if (batteryFindProc.running) batteryFindProc.signal(15)
      batteryWatchdogKill.restart()
    }
  }
  Timer {
    id: batteryWatchdogKill
    interval: root.killMs - root.termMs
    repeat: false
    onTriggered: if (batteryFindProc.running) batteryFindProc.signal(9)
  }

  // -------------------------------------------------------------- live apply

  property var _queue: []
  property string _liveErr: ""

  function applyLive(cfg) {
    _queue = _queue.concat(Model.applyPlan(cfg))
    if (!liveProc.running) _flush()
  }

  function runOne(argv) {
    _queue = _queue.concat([argv])
    if (!liveProc.running) _flush()
  }

  function _flush() {
    if (_queue.length === 0) return
    var next = _queue[0]
    _queue = _queue.slice(1)
    _liveErr = ""
    liveProc.command = next
    root._watchTarget = "live"
    watchdogTerm.restart()
    liveProc.running = true
  }

  Process {
    id: liveProc
    stderr: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._liveErr.length + data.length <= root.errorCap) root._liveErr += data
      }
    }
    onExited: {
      watchdogTerm.stop()
      watchdogKill.stop()
      var m = String(root._liveErr || "").trim()
      root.lastError = (m.length > 0 && m !== "ok") ? m : ""
      root._flush()
      if (root._queue.length === 0) root.refresh()
    }
  }

  // Deadline + escalation for every child process: TERM at termMs, KILL at
  // killMs if it ignored the TERM. Single exec'd binaries, so there is no
  // shell tree to orphan.
  property string _watchTarget: ""
  Timer {
    id: watchdogTerm
    interval: root.termMs
    repeat: false
    onTriggered: {
      if (root._watchTarget === "refresh" && refreshProc.running) refreshProc.signal(15)
      else if (root._watchTarget === "live" && liveProc.running) liveProc.signal(15)
      watchdogKill.restart()
    }
  }
  Timer {
    id: watchdogKill
    interval: root.killMs - root.termMs
    repeat: false
    onTriggered: {
      if (root._watchTarget === "refresh" && refreshProc.running) refreshProc.signal(9)
      else if (root._watchTarget === "live" && liveProc.running) liveProc.signal(9)
    }
  }

  // -------------------------------------------------------------- managed file

  function writeManaged(cfg) {
    luaFile.setText(Model.generateLua(cfg))
    // Re-check the loader line on every write. hyprland.lua is the user's
    // shared config: it is read through BoundedRead (no follow, capped) and
    // the marked line is appended only when the marker is absent — a line
    // the user removed is not fought over and a duplicate is never added.
    hyprlandLuaRead()
  }

  function hyprlandLuaRead() {
    luaReader.read(root.hyprlandLuaPath)
  }

  function _hyprlandLuaRead(ok, overflow, absent, content) {
    if (absent) {
      root.loaderInstalled = false
      return
    }
    if (!ok) {
      // Symlink, FIFO, oversized, unreadable: fail closed — do not modify a
      // shared file whose identity we could not establish.
      root.loaderInstalled = false
      console.warn("magic-trackpad: hyprland.lua read refused — loader line not installed")
      return
    }
    if (Model.needsLoader(content)) {
      // atomicWrites: temp + rename, which replaces a symlink rather than
      // writing through it.
      hyprlandLuaFile.setText(Model.withLoader(content))
    }
    root.loaderInstalled = true
  }

  BoundedRead {
    id: luaReader
    cap: 262144          // hyprland.lua is user config; refuse absurd sizes
    onFinished: function (ok, overflow, absent, content) {
      root._hyprlandLuaRead(ok, overflow, absent, content)
    }
  }

  // Write-only: all reads of these files go through BoundedRead above.
  // blockAllReads: true makes an accidental .text() a bug by construction.
  FileView {
    id: luaFile
    path: root.luaPath
    preload: false
    blockAllReads: true
    atomicWrites: true
    watchChanges: false
    printErrors: false
  }

  FileView {
    id: hyprlandLuaFile
    path: root.hyprlandLuaPath
    preload: false
    blockAllReads: true
    atomicWrites: true
    watchChanges: false
    printErrors: false
  }

  Component.onCompleted: refresh()
}

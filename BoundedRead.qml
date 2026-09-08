import QtQuick
import Quickshell
import Quickshell.Io

// Bounded, symlink-refusing file read.
//
// Reads run through /usr/bin/dd invoked as a fixed argv array — no shell —
// with iflag=nofollow,nonblock,count_bytes,fullblock:
//
//   nofollow     a planted symlink at the path fails the read (ELOOP) instead
//                of being followed
//   nonblock     a planted FIFO cannot hang the open() or a read() — the
//                whole desktop shares this process
//   count_bytes  the byte ceiling is enforced by the producer, before the
//                data is collected
//
// The output is checked against `cap` here as well (cap + one block of
// headroom is read, so overflow is detected and refused, never truncated
// into shape). Reads are queued one at a time and every one is under a
// TERM/KILL watchdog. A failed read is reported as failed: the consumer
// decides, it never falls through to "the file is absent".
Item {
  id: root

  // Maximum accepted file size in bytes. The dd read pulls cap + 4096 so an
  // oversized file is detectable (output > cap) rather than silently cut.
  property int cap: 65536
  property int termMs: 5000
  property int killMs: 8000

  // ok:       read completed, content holds the bytes, size <= cap
  // overflow: the file exceeded cap — content is empty, value refused
  // absent:   the path does not exist (ENOENT — distinct from every refusal)
  signal finished(bool ok, bool overflow, bool absent, string content, string err)

  property var _queue: []
  property string _current: ""
  property string _buf: ""
  property string _err: ""
  property bool _overflow: false

  function read(path) {
    if (typeof path !== "string" || path.length === 0) return
    _queue.push(path)
    if (!proc.running) _next()
  }

  function _next() {
    if (_queue.length === 0) return
    _current = _queue[0]
    _queue = _queue.slice(1)
    _buf = ""
    _err = ""
    _overflow = false
    proc.command = [
      "/usr/bin/dd", "if=" + _current,
      "iflag=nofollow,nonblock,count_bytes,fullblock",
      "bs=4096", "count=" + (root.cap + 4096), "status=none"
    ]
    termTimer.restart()
    proc.running = true
  }

  Process {
    id: proc

    // splitMarker: "" streams every chunk; the cap is enforced as the bytes
    // arrive, before anything beyond it is buffered. Overflow kills the read.
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._buf.length + data.length > root.cap) {
          root._overflow = true
          root._buf = ""
          proc.signal(15)
          return
        }
        root._buf += data
      }
    }
    stderr: SplitParser {
      splitMarker: ""
      onRead: function (data) {
        if (root._err.length + data.length <= 2048) root._err += data
      }
    }
    onExited: {
      termTimer.stop()
      killTimer.stop()
      var ok = !root._overflow && proc.exitCode === 0
      var absent = proc.exitCode !== 0 && root._err.indexOf("No such file or directory") >= 0
      if (!ok) {
        console.warn("magic-trackpad: bounded read of", root._current, "refused (",
                     root._overflow ? "over cap" : "exit " + proc.exitCode,
                     (absent ? "absent" : root._err.trim()), ")")
      }
      root.finished(ok, root._overflow, absent, ok ? root._buf : "", root._err)
      if (root._queue.length > 0) _next()
    }
  }

  // Deadline + escalation, same pattern as HyprSync's hyprctl watchdog.
  Timer {
    id: termTimer
    interval: root.termMs
    repeat: false
    onTriggered: {
      if (proc.running) proc.signal(15)
      killTimer.restart()
    }
  }
  Timer {
    id: killTimer
    interval: root.killMs - root.termMs
    repeat: false
    onTriggered: if (proc.running) proc.signal(9)
  }
}

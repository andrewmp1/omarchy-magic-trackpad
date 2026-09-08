import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar button + popup for libinput touchpad behaviour.
// Level 1: everything here is a plain libinput / Hyprland setting, applied
// live with `hyprctl eval "hl.config{...}"` / `"hl.device{...}"` and persisted
// to a managed Lua file. No daemon, no elevated permissions.
//
// v0.2 adds a scope: "Global" writes Hyprland's `input.touchpad` section;
// picking a detected touchpad writes an `hl.device` block for that pad only.
// A device scope that hasn't overridden an option inherits Global.
Panel {
  id: root
  moduleName: "andrewmp1.magic-trackpad"
  ipcTarget: "magic-trackpad"

  readonly property color fg: bar ? bar.foreground : Color.foreground
  readonly property color accent: Color.accent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var cfg: store.config
  property bool cursorActive: false
  property int cursorIndex: 0
  property bool appliedOnce: false
  property string notice: ""

  // "global" or a detected touchpad's device slug.
  property string scope: Model.GLOBAL
  // Reset-to-global confirmation is showing.
  property bool resetPending: false

  // Global + one entry per detected touchpad. Labels are pre-stripped and
  // length-capped in Model.deviceLabel — they land in host-owned sinks
  // (ButtonGroup / Dropdown) that cannot be pinned to PlainText.
  readonly property var scopeOptions: {
    var opts = [{ value: Model.GLOBAL, label: "Global" }]
    var devs = sync.touchpadDevices || []
    for (var i = 0; i < devs.length && opts.length < 13; i++)
      opts.push({ value: devs[i].name, label: devs[i].label })
    return opts
  }
  readonly property bool scopeUsesDropdown: scopeOptions.length > 3
  readonly property bool scopeIsDevice: scope !== Model.GLOBAL
  readonly property string scopeLabel: {
    for (var i = 0; i < scopeOptions.length; i++)
      if (scopeOptions[i].value === scope) return scopeOptions[i].label
    return "Global"
  }
  readonly property bool scopeDropdownOpen:
    scopePicker.item && ("popupOpen" in scopePicker.item) && scopePicker.item.popupOpen

  // Flat list of things the panel cursor can land on.
  //   { kind: "scope" }  { kind: "toggle", key, field, label }
  //   { kind: "scroll" }  { kind: "reset" }
  readonly property var navItems: {
    var items = []
    if (scopeOptions.length > 1) items.push({ kind: "scope" })
    for (var i = 0; i < Model.TOUCHPAD_TOGGLES.length; i++) {
      var t = Model.TOUCHPAD_TOGGLES[i]
      items.push({ kind: "toggle", key: t.key, field: t.field, label: t.label })
    }
    items.push({ kind: "scroll" })
    if (scopeIsDevice && Model.deviceOverrideCount(cfg, scope) > 0) items.push({ kind: "reset" })
    return items
  }

  function setCursorToKind(kind, key) {
    for (var i = 0; i < navItems.length; i++) {
      if (navItems[i].kind !== kind) continue
      if (kind === "toggle" && key !== undefined && navItems[i].key !== key) continue
      cursorIndex = i
      return
    }
  }

  function moveCursor(delta) {
    if (resetPending) {
      resetConfirm.selectedIndex = resetConfirm.selectedIndex === 0 ? 1 : 0
      return
    }
    if (!cursorActive) { cursorActive = true; return }
    var n = navItems.length
    cursorIndex = ((cursorIndex + delta) % n + n) % n
  }

  function activateCursor() {
    if (resetPending) {
      if (resetConfirm.selectedIndex === 1) doResetToGlobal()
      else resetPending = false
      return
    }
    if (!cursorActive) { cursorActive = true; return }
    var item = navItems[cursorIndex]
    if (!item) return
    if (item.kind === "scope") {
      if (scopeUsesDropdown && scopePicker.item) scopePicker.item.toggle()
      else cycleScope()
    } else if (item.kind === "toggle") {
      setToggle(item.key, item.field, !Model.effectiveToggle(cfg, sync.liveValues, scope, item.key))
    } else if (item.kind === "scroll") {
      cycleScroll()
    } else if (item.kind === "reset") {
      resetConfirm.selectedIndex = 1
      resetPending = true
    }
  }

  // ------------------------------------------------------------- scope

  function cycleScope() {
    var opts = scopeOptions
    var i = 0
    for (; i < opts.length; i++) if (opts[i].value === scope) break
    setScope(opts[(i + 1) % opts.length].value)
  }

  function setScope(v) {
    if (v !== Model.GLOBAL) {
      var ok = false
      for (var i = 0; i < scopeOptions.length; i++) if (scopeOptions[i].value === v) ok = true
      if (!ok) return
    }
    scope = v
    cursorActive = true
    cursorIndex = 0
  }

  // index of the current scope, for the ButtonGroup cursor highlight
  function scopeIndex() {
    for (var i = 0; i < scopeOptions.length; i++) if (scopeOptions[i].value === scope) return i
    return 0
  }

  // A detached touchpad drops back to Global so the panel never points at a
  // device that is no longer there.
  Connections {
    target: sync
    function onTouchpadDevicesChanged() {
      if (root.scope === Model.GLOBAL) return
      var devs = sync.touchpadDevices || []
      for (var i = 0; i < devs.length; i++) if (devs[i].name === root.scope) return
      root.scope = Model.GLOBAL
      root.cursorIndex = 0
    }
  }

  // ------------------------------------------------------------- mutations

  // The entry (global section or a device sub-object) the current scope writes.
  function _entryFor(d, sc) {
    if (sc === Model.GLOBAL) {
      if (!d.global) d.global = { touchpad: {}, scrollSpeed: null }
      return d.global
    }
    if (!d.devices) d.devices = {}
    if (!d.devices[sc]) d.devices[sc] = { touchpad: {}, scrollSpeed: null }
    return d.devices[sc]
  }

  function setToggle(key, field, value) {
    var sc = scope
    store.mutate(function (d) { root._entryFor(d, sc).touchpad[key] = value })
    if (sc === Model.GLOBAL) {
      sync.runOne(Model.toggleEvalArgs(field, value))
    } else {
      var a = Model.deviceToggleEvalArgs(sc, field, value)
      if (a) sync.runOne(a)
    }
    sync.writeManaged(store.config)
    flash(value ? "On" : "Off")
  }

  function setScroll(key) {
    var sc = scope
    store.mutate(function (d) { root._entryFor(d, sc).scrollSpeed = key })
    var val = Model.scrollStopValue(key)
    if (sc === Model.GLOBAL) {
      sync.runOne(Model.toggleEvalArgs(Model.SCROLL_FIELD, val))
    } else {
      var a = Model.deviceToggleEvalArgs(sc, Model.SCROLL_FIELD, val)
      if (a) sync.runOne(a)
    }
    sync.writeManaged(store.config)
    flash("Scroll: " + key)
  }

  function cycleScroll() {
    var order = Model.SCROLL_STOPS.map(function (s) { return s.key })
    var idx = Math.max(0, order.indexOf(Model.effectiveScroll(cfg, sync.liveValues, scope)))
    setScroll(order[(idx + 1) % order.length])
  }

  // index of the current scroll stop, for the ButtonGroup cursor highlight
  function scrollIndex() {
    var cur = Model.effectiveScroll(cfg, sync.liveValues, scope)
    for (var i = 0; i < Model.SCROLL_STOPS.length; i++) if (Model.SCROLL_STOPS[i].key === cur) return i
    return 1
  }

  function doResetToGlobal() {
    var sc = scope
    resetPending = false
    if (sc === Model.GLOBAL) return
    var args = Model.resetDeviceEvalArgs(store.config, sync.liveValues, sc)
    store.mutate(function (d) { if (d.devices) delete d.devices[sc] })
    if (args) sync.runOne(args)
    sync.writeManaged(store.config)
    cursorIndex = 0
    flash("Reset to global")
  }

  function flash(text) {
    notice = text
    noticeTimer.restart()
  }

  Timer { id: noticeTimer; interval: 1800; repeat: false; onTriggered: root.notice = "" }

  // ------------------------------------------------------------- wiring

  ConfigStore {
    id: store
    onLoaded: function (existed) {
      if (root.appliedOnce) return
      root.appliedOnce = true
      // Startup is read-only: push whatever the document already holds to the
      // running session and read Hyprland's current values. Nothing is
      // written until the user changes something — the managed Lua file and
      // the loader line are installed by writeManaged() from the mutation
      // handlers, not here.
      if (existed) sync.applyLive(store.config)
      sync.refresh()
    }
  }

  HyprSync { id: sync }

  // ------------------------------------------------------------- bar button

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    tooltipText: "Trackpad · " + Model.summaryLine(root.cfg)
    iconComponent: Component {
      Item {
        Rectangle {
          anchors.centerIn: parent
          width: Math.round(parent.width)
          height: Math.round(parent.width * 0.7)
          radius: Math.max(2, width * 0.14)
          color: "transparent"
          border.width: Math.max(1, Math.round(width * 0.09))
          border.color: button.foreground
          opacity: Model.summaryLine(root.cfg) !== "defaults" ? 1.0 : 0.78

          Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.topMargin: Math.round(parent.height * 0.18)
            width: Math.round(parent.width * 0.34)
            height: Math.max(1, Math.round(parent.height * 0.09))
            radius: height
            color: button.foreground
          }
        }
      }
    }
    onPressed: function (mouseButton) {
      if (mouseButton === Qt.LeftButton) root.toggle()
    }
  }

  // ------------------------------------------------------------- popup

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(372))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // While the scope dropdown's popup owns keys, freeze the panel cursor
      // and let the dropdown drive itself. The reset dialog is driven through
      // the semantic signals below, so it does not need to block.
      blocked: root.scopeDropdownOpen
      onMoveRequested: function (dx, dy) { root.moveCursor(dx !== 0 ? dx : dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: {
        if (root.resetPending) { root.resetPending = false; return }
        root.close()
      }
      onTabRequested: function (direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        // ---- hero: glyph · title · summary ----
        Row {
          width: parent.width
          spacing: Style.space(11)

          Rectangle {
            id: heroGlyph
            width: Style.space(30)
            height: Style.space(21)
            anchors.verticalCenter: parent.verticalCenter
            radius: Math.max(2, Style.space(5))
            color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.10)
            border.width: Math.max(1, Style.space(2) - 1)
            border.color: root.accent
            Rectangle {
              anchors.horizontalCenter: parent.horizontalCenter
              anchors.top: parent.top
              anchors.topMargin: Style.space(4)
              width: Style.space(10)
              height: Math.max(1, Style.space(2))
              radius: height
              color: root.accent
            }
          }

          Column {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - heroGlyph.width - parent.spacing
            spacing: Style.space(1)
            Text {
              text: "Trackpad"
              textFormat: Text.PlainText
              color: root.fg
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
            }
            Text {
              text: {
                if (root.notice !== "") return root.notice
                var s = Model.summaryLine(root.cfg, root.scope).toUpperCase()
                return root.scopeIsDevice ? (root.scopeLabel.toUpperCase() + " · " + s) : s
              }
              textFormat: Text.PlainText
              color: Qt.darker(root.fg, 1.45)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.1
              elide: Text.ElideRight
              width: parent.width
            }
          }
        }

        PanelSeparator { foreground: root.fg }

        // ---- scope picker (only when a touchpad was detected) ----
        PanelSectionHeader {
          visible: root.scopeOptions.length > 1
          text: "SCOPE"
          foreground: root.fg
          fontFamily: root.fontFamily
        }

        Loader {
          id: scopePicker
          width: parent.width
          visible: root.scopeOptions.length > 1
          active: visible
          sourceComponent: root.scopeUsesDropdown ? scopeDropdownComp : scopeButtonsComp
        }

        Component {
          id: scopeButtonsComp
          ButtonGroup {
            width: scopePicker.width
            options: root.scopeOptions
            value: root.scope
            foreground: root.fg
            background: root.bar ? root.bar.background : Color.background
            accent: root.accent
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            focusable: false
            cursorIndex: (root.cursorActive && root.navItems[root.cursorIndex]
              && root.navItems[root.cursorIndex].kind === "scope") ? root.scopeIndex() : -1
            onChanged: function (v) { root.setScope(v) }
            onHovered: function (index, isHovered) {
              if (isHovered) { root.cursorActive = true; root.setCursorToKind("scope") }
            }
          }
        }

        Component {
          id: scopeDropdownComp
          Dropdown {
            width: scopePicker.width
            showLabel: false
            options: root.scopeOptions
            value: root.scope
            foreground: root.fg
            accent: root.accent
            fontFamily: root.fontFamily
            hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
              && root.navItems[root.cursorIndex].kind === "scope"
            onChanged: function (v) { root.setScope(v) }
            onHovered: function (h) {
              if (h) { root.cursorActive = true; root.setCursorToKind("scope") }
            }
          }
        }

        PanelSeparator { visible: root.scopeOptions.length > 1; foreground: root.fg }

        // ---- touchpad toggles ----
        PanelSectionHeader { text: "TOUCHPAD"; foreground: root.fg; fontFamily: root.fontFamily }

        Column {
          width: parent.width
          spacing: Style.space(3)
          Repeater {
            model: Model.TOUCHPAD_TOGGLES
            Item {
              id: rowWrap
              required property var modelData
              width: column.width
              implicitHeight: tog.implicitHeight
              Toggle {
                id: tog
                width: parent.width
                label: rowWrap.modelData.label
                description: (root.scopeIsDevice
                  && Model.isInherited(root.cfg, root.scope, rowWrap.modelData.key))
                  ? "Inherited from Global" : ""
                foreground: root.fg
                accent: root.accent
                fontFamily: root.fontFamily
                checked: Model.effectiveToggle(root.cfg, sync.liveValues, root.scope, rowWrap.modelData.key)
                hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
                  && root.navItems[root.cursorIndex].kind === "toggle"
                  && root.navItems[root.cursorIndex].key === rowWrap.modelData.key
                onClicked: root.setToggle(rowWrap.modelData.key, rowWrap.modelData.field,
                  !Model.effectiveToggle(root.cfg, sync.liveValues, root.scope, rowWrap.modelData.key))
                onHovered: function (h) {
                  if (h) {
                    root.cursorActive = true
                    root.setCursorToKind("toggle", rowWrap.modelData.key)
                  }
                }
              }
            }
          }
        }

        PanelSeparator { foreground: root.fg }

        // ---- scroll speed ----
        PanelSectionHeader { text: "SCROLL SPEED"; foreground: root.fg; fontFamily: root.fontFamily }

        ButtonGroup {
          id: scrollGroup
          width: parent.width
          options: [
            { value: "slow", label: "Slow" },
            { value: "normal", label: "Normal" },
            { value: "fast", label: "Fast" }
          ]
          value: Model.effectiveScroll(root.cfg, sync.liveValues, root.scope)
          foreground: root.fg
          background: root.bar ? root.bar.background : Color.background
          accent: root.accent
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          focusable: false
          cursorIndex: (root.cursorActive && root.navItems[root.cursorIndex]
            && root.navItems[root.cursorIndex].kind === "scroll") ? root.scrollIndex() : -1
          onChanged: function (v) { root.setScroll(v) }
          onHovered: function (index, isHovered) {
            if (isHovered) { root.cursorActive = true; root.setCursorToKind("scroll") }
          }
        }

        // ---- reset to global (device scope with overrides) ----
        Button {
          id: resetButton
          width: parent.width
          visible: root.scopeIsDevice && Model.deviceOverrideCount(root.cfg, root.scope) > 0
          text: "Reset " + root.scopeLabel + " to Global"
          bordered: true
          foreground: root.fg
          background: root.bar ? root.bar.background : Color.background
          accent: root.accent
          fontFamily: root.fontFamily
          hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
            && root.navItems[root.cursorIndex].kind === "reset"
          onClicked: { resetConfirm.selectedIndex = 1; root.resetPending = true }
          onHovered: function (h) {
            if (h) { root.cursorActive = true; root.setCursorToKind("reset") }
          }
        }

        PanelSeparator { foreground: root.fg }

        Text {
          width: parent.width
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: sync.lastError !== ""
            ? ("hyprctl: " + sync.lastError)
            : "Finger-swipe gestures, Taptic Engine strength, and custom gestures come in a later version."
          color: sync.lastError !== "" ? Color.urgent : Qt.darker(root.fg, 1.5)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      // Reset-to-global confirmation. Driven through the panel's semantic
      // key signals (moveCursor / activateCursor / close) while resetPending,
      // so it needs no key handler of its own.
      ConfirmDialog {
        id: resetConfirm
        anchors.fill: parent
        z: 50
        opened: root.resetPending
        message: "Reset " + root.scopeLabel + " to the Global settings?"
        confirmText: "Reset"
        cancelText: "Keep"
        background: root.bar ? root.bar.background : Color.background
        foreground: root.fg
        fontFamily: root.fontFamily
        onCanceled: root.resetPending = false
        onConfirmed: root.doResetToGlobal()
      }
    }
  }

  onOpenedChanged: {
    if (opened) {
      cursorActive = false
      cursorIndex = 0
      resetPending = false
      sync.refresh()
    }
  }
}

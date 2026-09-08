import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar button + popup for libinput touchpad behaviour.
// Level 1: everything here is a plain libinput / Hyprland setting, applied
// live with `hyprctl eval "hl.config{...}"` and persisted to a managed Lua file.
// No daemon, no elevated permissions.
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

  // Flat list of things the panel cursor can land on.
  //   { kind: "toggle", key, field, label }   { kind: "scroll" }
  readonly property var navItems: {
    var items = []
    for (var i = 0; i < Model.TOUCHPAD_TOGGLES.length; i++) {
      var t = Model.TOUCHPAD_TOGGLES[i]
      items.push({ kind: "toggle", key: t.key, field: t.field, label: t.label })
    }
    items.push({ kind: "scroll" })
    return items
  }

  function moveCursor(delta) {
    if (!cursorActive) { cursorActive = true; return }
    var n = navItems.length
    cursorIndex = ((cursorIndex + delta) % n + n) % n
  }

  function activateCursor() {
    if (!cursorActive) { cursorActive = true; return }
    var item = navItems[cursorIndex]
    if (!item) return
    if (item.kind === "toggle") setToggle(item.key, item.field, !Model.effectiveToggle(cfg, sync.liveValues, item.key))
    else if (item.kind === "scroll") cycleScroll()
  }

  // ------------------------------------------------------------- mutations

  function setToggle(key, field, value) {
    store.mutate(function (d) { d.touchpad[key] = value })
    sync.runOne(Model.toggleEvalArgs(field, value))
    sync.writeManaged(store.config)
    flash(value ? "On" : "Off")
  }

  function setScroll(key) {
    store.mutate(function (d) { d.scrollSpeed = key })
    sync.runOne(Model.toggleEvalArgs(Model.SCROLL_FIELD, Model.scrollStopValue(key)))
    sync.writeManaged(store.config)
    flash("Scroll: " + key)
  }

  function cycleScroll() {
    var order = Model.SCROLL_STOPS.map(function (s) { return s.key })
    var idx = Math.max(0, order.indexOf(Model.effectiveScroll(cfg, sync.liveValues)))
    setScroll(order[(idx + 1) % order.length])
  }

  // index of the current scroll stop, for the ButtonGroup cursor highlight
  function scrollIndex() {
    var cur = Model.effectiveScroll(cfg, sync.liveValues)
    for (var i = 0; i < Model.SCROLL_STOPS.length; i++) if (Model.SCROLL_STOPS[i].key === cur) return i
    return 1
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
    contentWidth: panel.fittedContentWidth(Style.space(358))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function (dx, dy) { root.moveCursor(dx !== 0 ? dx : dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
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
              text: root.notice !== "" ? root.notice : Model.summaryLine(root.cfg).toUpperCase()
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
                foreground: root.fg
                accent: root.accent
                fontFamily: root.fontFamily
                checked: Model.effectiveToggle(root.cfg, sync.liveValues, rowWrap.modelData.key)
                hasCursor: root.cursorActive && root.navItems[root.cursorIndex]
                  && root.navItems[root.cursorIndex].kind === "toggle"
                  && root.navItems[root.cursorIndex].key === rowWrap.modelData.key
                onClicked: root.setToggle(rowWrap.modelData.key, rowWrap.modelData.field,
                  !Model.effectiveToggle(root.cfg, sync.liveValues, rowWrap.modelData.key))
                onHovered: function (h) {
                  if (h) {
                    root.cursorActive = true
                    for (var i = 0; i < root.navItems.length; i++)
                      if (root.navItems[i].kind === "toggle" && root.navItems[i].key === rowWrap.modelData.key) root.cursorIndex = i
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
          value: Model.effectiveScroll(root.cfg, sync.liveValues)
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
            if (isHovered) {
              root.cursorActive = true
              for (var i = 0; i < root.navItems.length; i++)
                if (root.navItems[i].kind === "scroll") root.cursorIndex = i
            }
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
    }
  }

  onOpenedChanged: {
    if (opened) {
      cursorActive = false
      cursorIndex = 0
      sync.refresh()
    }
  }
}

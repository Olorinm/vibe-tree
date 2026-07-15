import AppKit
import Darwin

final class MenuBarController: NSObject {
  private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

  init(iconPath: String) {
    super.init()
    guard let button = statusItem.button,
          let image = NSImage(contentsOfFile: iconPath) else {
      fatalError("Unable to load the Vibe Tree menu bar icon")
    }

    image.size = NSSize(width: 18, height: 18)
    image.isTemplate = true
    button.image = image
    button.toolTip = "Vibe Tree"
    button.target = self
    button.action = #selector(handleClick)
    button.sendAction(on: [.leftMouseUp, .rightMouseUp])
  }

  @objc private func handleClick() {
    let eventName = NSApp.currentEvent?.type == .rightMouseUp ? "right-click" : "left-click"
    let point = NSEvent.mouseLocation
    print("\(eventName)\t\(point.x)\t\(point.y)")
    fflush(stdout)
  }
}

if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--check" {
  guard NSImage(contentsOfFile: CommandLine.arguments[2]) != nil else {
    fputs("Unable to load the Vibe Tree menu bar icon\n", stderr)
    exit(1)
  }
  print("macOS menu bar helper check passed")
  exit(0)
}

guard CommandLine.arguments.count >= 3,
      let parentPid = Int32(CommandLine.arguments[2]) else {
  fputs("Usage: vibe-tree-menu-bar-helper <icon-path> <parent-pid>\n", stderr)
  exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = MenuBarController(iconPath: CommandLine.arguments[1])

Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
  if kill(parentPid, 0) != 0 {
    NSApp.terminate(nil)
  }
}

app.run()

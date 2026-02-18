import AppIntents
import SwiftUI

@main
struct steveApp: App {
  init() {
    SteveShortcuts.updateAppShortcutParameters()
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}

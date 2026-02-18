import AppIntents

struct ToggleRecordingIntent: AppIntent {
  static var title: LocalizedStringResource = "Toggle Recording"
  static var description = IntentDescription("Starts or stops recording in Steve.")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    await MainActor.run {
      VoiceService.shared.toggle()
    }
    return .result()
  }
}

struct SteveShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ToggleRecordingIntent(),
      phrases: [
        "Toggle recording in \(.applicationName)",
        "Start recording in \(.applicationName)",
        "Stop recording in \(.applicationName)",
      ],
      shortTitle: "Recording",
      systemImageName: "mic.fill"
    )
  }

  static var shortcutTileColor: ShortcutTileColor {
    .orange
  }
}

import SwiftUI

struct ContentView: View {
  @State private var voice = VoiceService.shared
  @State private var settings = false

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        Button(voice.recording ? "Stop" : "Record") {
          if voice.recording {
            voice.stop()
            return
          }
          voice.start()
        }
        .font(.title)
        .padding(.horizontal, 40)
        .padding(.vertical, 16)
        .background(voice.recording ? Color.red : Color.blue)
        .foregroundColor(.white)
        .cornerRadius(12)

        if !voice.status.isEmpty {
          Text(voice.status)
            .font(.caption)
            .foregroundColor(.secondary)
        }

        if voice.bytes > 0 {
          Text(format(voice.bytes))
            .font(.caption2)
            .foregroundColor(.secondary)
        }

        if !voice.transcript.isEmpty {
          Text(voice.transcript)
            .font(.body)
            .padding()
        }
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            settings = true
          } label: {
            Image(systemName: "gearshape")
          }
        }
      }
      .navigationDestination(isPresented: $settings) {
        SettingsView()
      }
    }
  }

  func format(_ bytes: Int) -> String {
    if bytes < 1024 {
      return "\(bytes) B"
    }
    if bytes < 1024 * 1024 {
      return String(format: "%.1f KB", Double(bytes) / 1024.0)
    }
    return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
  }
}

#Preview {
  ContentView()
}

import SwiftUI

struct ContentView: View {
  @State private var voice = VoiceService.shared
  @State private var settings = false

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(spacing: 12) {
              ForEach(voice.messages) { msg in
                Bubble(message: msg)
                  .id(msg.id)
              }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
          }
          .onChange(of: voice.messages.count) {
            if let last = voice.messages.last {
              withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
          }
        }

        Divider()

        VStack(spacing: 8) {
          if !voice.status.isEmpty {
            Text(voice.status)
              .font(.caption)
              .foregroundColor(.secondary)
          }

          Button(voice.recording ? "Stop" : "Record") {
            if voice.recording {
              voice.stop()
              return
            }
            voice.start()
          }
          .font(.title2)
          .padding(.horizontal, 40)
          .padding(.vertical, 12)
          .background(voice.recording ? Color.red : Color.blue)
          .foregroundColor(.white)
          .cornerRadius(12)
        }
        .padding(.vertical, 12)
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
}

struct Bubble: View {
  let message: ChatMessage

  var body: some View {
    HStack {
      if message.role == .user { Spacer(minLength: 60) }

      Text(message.text)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(message.role == .user ? Color.blue : Color(.systemGray5))
        .foregroundColor(message.role == .user ? .white : .primary)
        .cornerRadius(16)

      if message.role == .agent { Spacer(minLength: 60) }
    }
  }
}

#Preview {
  ContentView()
}

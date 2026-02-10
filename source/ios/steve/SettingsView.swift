import SwiftUI

struct SettingsView: View {
  @AppStorage("serverURL") private var server = "ws://localhost:1977"

  var body: some View {
    Form {
      Section("Server") {
        TextField("URL", text: $server)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)

        if !server.isEmpty {
          Text(server)
            .font(.caption2)
            .foregroundColor(.secondary)
        }
      }
    }
    .navigationTitle("Settings")
  }
}

#Preview {
  NavigationStack {
    SettingsView()
  }
}

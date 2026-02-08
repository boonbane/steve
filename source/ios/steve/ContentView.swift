import SwiftUI
import AVFoundation

struct ContentView: View {
    @State var recording = false
    @State var size: String = ""
    @State var recorder: AVAudioRecorder? = nil
    @State var url: URL? = nil

    var body: some View {
        VStack(spacing: 24) {
            Button(recording ? "Stop" : "Record") {
                if recording {
                    stop()
                    return
                }
                start()
            }
            .font(.title)
            .padding(.horizontal, 40)
            .padding(.vertical, 16)
            .background(recording ? Color.red : Color.blue)
            .foregroundColor(.white)
            .cornerRadius(12)

            if !size.isEmpty {
                Text(size)
                    .font(.body)
                    .foregroundColor(.secondary)
            }
        }
    }

    func start() {
        let session = AVAudioSession.sharedInstance()
        guard (try? session.setCategory(.record, mode: .default)) != nil else { return }
        guard (try? session.setActive(true)) != nil else { return }

        AVAudioApplication.requestRecordPermission { granted in
            guard granted else { return }

            let path = FileManager.default.temporaryDirectory.appendingPathComponent("recording.m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]

            guard let r = try? AVAudioRecorder(url: path, settings: settings) else { return }
            r.record()
            DispatchQueue.main.async {
                recorder = r
                url = path
                recording = true
                size = ""
            }
        }
    }

    func stop() {
        recorder?.stop()
        recording = false

        guard let path = url else { return }
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path.path) else { return }
        guard let bytes = attrs[.size] as? Int64 else { return }

        if bytes < 1024 {
            size = "\(bytes) bytes"
            return
        }
        if bytes < 1024 * 1024 {
            size = String(format: "%.1f KB", Double(bytes) / 1024.0)
            return
        }
        size = String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
    }
}

#Preview {
    ContentView()
}

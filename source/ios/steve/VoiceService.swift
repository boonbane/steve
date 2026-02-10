import AVFoundation
import Foundation

@Observable
final class VoiceService {
  static let shared = VoiceService()

  enum State: Equatable {
    case idle
    case streaming
    case done
    case disconnected
    case failed(String)
  }

  var recording = false
  var transcript = ""
  var state: State = .idle
  var bytes = 0

  var status: String {
    switch state {
    case .idle:
      return ""
    case .streaming:
      return "streaming"
    case .done:
      return "done"
    case .disconnected:
      return "disconnected"
    case .failed(let message):
      return message
    }
  }

  private var engine: AVAudioEngine?
  private var task: URLSessionWebSocketTask?

  private var url: URL {
    let base = UserDefaults.standard.string(forKey: "serverURL") ?? "ws://localhost:1977"
    return URL(string: "\(base)/voice")!
  }

  private struct Msg: Decodable {
    let type: String
    let text: String?
    let message: String?
  }

  func start() {
    Task {
      let granted = await AVAudioApplication.requestRecordPermission()
      guard granted else {
        await MainActor.run { state = .failed("microphone permission denied") }
        return
      }

      let session = AVAudioSession.sharedInstance()
      do {
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true)
      } catch {
        await MainActor.run { state = .failed("audio session: \(error.localizedDescription)") }
        return
      }

      await MainActor.run { begin() }
    }
  }

  func stop() {
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
    engine = nil
    task?.cancel(with: .normalClosure, reason: nil)
    task = nil
    recording = false
    if case .streaming = state {
      state = .idle
    }
  }

  func toggle() {
    if recording {
      stop()
      return
    }
    start()
  }

  private func begin() {
    transcript = ""
    state = .idle
    bytes = 0

    let ws = URLSession.shared.webSocketTask(with: url)
    task = ws
    ws.resume()
    listen(ws)

    let audioEngine = AVAudioEngine()
    let source = audioEngine.inputNode
    let outputFormat = source.outputFormat(forBus: 0)

    guard
      let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16000,
        channels: 1,
        interleaved: true
      )
    else {
      state = .failed("failed to create target format")
      return
    }

    guard let converter = AVAudioConverter(from: outputFormat, to: targetFormat) else {
      state = .failed("failed to create converter")
      return
    }

    // install an audio callback which collects the PCM data and sends it via WS
    source.installTap(onBus: 0, bufferSize: 4096, format: outputFormat) { [weak self] buffer, _ in
      guard let self else { return }

      let capacity = AVAudioFrameCount(
        Double(buffer.frameLength) * targetFormat.sampleRate / outputFormat.sampleRate
      )
      guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity)
      else {
        return
      }

      var error: NSError?
      converter.convert(to: converted, error: &error) { _, status in
        status.pointee = .haveData
        return buffer
      }
      guard error == nil else { return }

      let data = Data(
        bytes: converted.int16ChannelData!.pointee,
        count: Int(converted.frameLength) * 2
      )

      DispatchQueue.main.async { self.bytes += data.count }
      ws.send(.data(data)) { _ in }
    }

    guard (try? audioEngine.start()) != nil else {
      state = .failed("failed to start audio engine")
      return
    }

    engine = audioEngine
    recording = true
    state = .streaming
  }

  private func listen(_ ws: URLSessionWebSocketTask) {
    ws.receive { [weak self] result in
      guard let self else { return }

      switch result {
      case .success(let msg):
        if case .string(let text) = msg {
          self.handle(text)
        }
        self.listen(ws)
      case .failure:
        DispatchQueue.main.async {
          self.state = .disconnected
          self.stop()
        }
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8),
      let msg = try? JSONDecoder().decode(Msg.self, from: data)
    else { return }

    DispatchQueue.main.async {
      switch msg.type {
      case "transcription":
        if let t = msg.text, !t.isEmpty {
          self.transcript = t
        }
      case "done":
        if let t = msg.text {
          self.transcript = t
        }
        self.state = .done
      case "error":
        if let m = msg.message {
          self.state = .failed("error: \(m)")
        }
      default:
        break
      }
    }
  }
}

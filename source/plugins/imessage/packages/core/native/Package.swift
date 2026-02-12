// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "imsg-native",
  products: [
    .library(name: "imsg", type: .dynamic, targets: ["IMsgNative"]),
  ],
  targets: [
    .target(name: "IMsgNative", path: "Sources/IMsgNative"),
  ]
)

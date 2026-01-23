// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MaestroMCPServer",
    platforms: [
        .macOS(.v13)
    ],
    dependencies: [
        .package(url: "https://github.com/modelcontextprotocol/swift-sdk", from: "0.7.1")
    ],
    targets: [
        .executableTarget(
            name: "MaestroMCPServer",
            dependencies: [
                .product(name: "MCP", package: "swift-sdk")
            ],
            path: "Sources/MaestroMCPServer"
        )
    ]
)

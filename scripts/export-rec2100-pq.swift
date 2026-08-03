#!/usr/bin/env swift

import CoreGraphics
import Foundation

enum ExportError: LocalizedError {
    case unavailable
    case colorSpaceCreationFailed
    case missingICCData

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Rec.2100 PQ requires macOS 11 or newer"
        case .colorSpaceCreationFailed:
            return "CoreGraphics could not create kCGColorSpaceITUR_2100_PQ"
        case .missingICCData:
            return "CoreGraphics did not provide ICC data for the Rec.2100 PQ color space"
        }
    }
}

func exportProfile(to outputURL: URL) throws {
    guard #available(macOS 11.0, *) else {
        throw ExportError.unavailable
    }

    guard let colorSpace = CGColorSpace(name: CGColorSpace.itur_2100_PQ) else {
        throw ExportError.colorSpaceCreationFailed
    }
    guard let profileData = colorSpace.copyICCData() as Data? else {
        throw ExportError.missingICCData
    }

    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try profileData.write(to: outputURL, options: .atomic)

    let profileName = colorSpace.name as String? ?? "kCGColorSpaceITUR_2100_PQ"
    print("Exported \(profileName) (\(profileData.count) bytes) to \(outputURL.path)")
}

let outputPath = CommandLine.arguments.dropFirst().first ?? "assets/rec2100-pq.icc"

do {
    try exportProfile(to: URL(fileURLWithPath: outputPath))
} catch {
    FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
    exit(EXIT_FAILURE)
}

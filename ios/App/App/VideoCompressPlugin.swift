import UIKit
import AVFoundation
import PhotosUI
import UniformTypeIdentifiers
import Capacitor

// Video for slides on the iPhone (SLIDES_DESIGN.md §8), exposed as the "VideoCompress"
// plugin (native-bridge.js → nativeVideoCompress()). pick() shows the photo library's
// video picker, compresses the chosen clip to 720p H.264/AAC MP4 on the phone, and
// returns it as base64 with its length and size. The original is never sent anywhere;
// the temporary files are deleted before returning.
//   • pick({ maxBytes }) → { data, mime, duration, width, height, bytes } | { cancelled: true }
@objc(VideoCompressPlugin)
public class VideoCompressPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "VideoCompressPlugin"
    public let jsName = "VideoCompress"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.bridge?.viewController else {
                call.reject("No view")
                return
            }
            if self.pending != nil {
                call.reject("Already choosing a video")
                return
            }
            var config = PHPickerConfiguration()
            config.filter = .videos
            config.selectionLimit = 1
            config.preferredAssetRepresentationMode = .current
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.pending = call
            vc.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pending else { return }
        guard let item = results.first?.itemProvider, item.hasItemConformingToTypeIdentifier(UTType.movie.identifier) else {
            pending = nil
            call.resolve(["cancelled": true])
            return
        }
        let maxBytes = call.getInt("maxBytes") ?? 60 * 1024 * 1024
        item.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] url, err in
            guard let self = self else { return }
            guard let url = url else {
                self.finish(error: err?.localizedDescription ?? "That video couldn't be read.")
                return
            }
            // The provided file disappears when this block returns: copy it first.
            let tmp = FileManager.default.temporaryDirectory
            let src = tmp.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension.isEmpty ? "mov" : url.pathExtension)
            let out = tmp.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp4")
            do { try FileManager.default.copyItem(at: url, to: src) } catch {
                self.finish(error: "That video couldn't be read.")
                return
            }
            self.compress(src: src, out: out, maxBytes: maxBytes)
        }
    }

    private func compress(src: URL, out: URL, maxBytes: Int) {
        let asset = AVURLAsset(url: src)
        let preset = AVAssetExportSession.exportPresets(compatibleWith: asset).contains(AVAssetExportPreset1280x720) ? AVAssetExportPreset1280x720 : AVAssetExportPresetMediumQuality
        guard let export = AVAssetExportSession(asset: asset, presetName: preset) else {
            cleanup([src])
            finish(error: "That video can't be compressed.")
            return
        }
        export.outputURL = out
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.exportAsynchronously { [weak self] in
            guard let self = self else { return }
            defer { self.cleanup([src, out]) }
            guard export.status == .completed, let data = try? Data(contentsOf: out) else {
                self.finish(error: export.error?.localizedDescription ?? "That video couldn't be compressed.")
                return
            }
            if data.count > maxBytes {
                self.finish(error: "That video is \(data.count / 1024 / 1024) MB after compression. Clips are kept to \(maxBytes / 1024 / 1024) MB (about 3 minutes); trim it in Photos first, or paste a YouTube link instead.")
                return
            }
            let dur = CMTimeGetSeconds(asset.duration)
            var w = 0.0, h = 0.0
            if let track = asset.tracks(withMediaType: .video).first {
                let size = track.naturalSize.applying(track.preferredTransform)
                w = abs(size.width); h = abs(size.height)
            }
            let call = self.pending
            self.pending = nil
            call?.resolve(["data": data.base64EncodedString(), "mime": "video/mp4", "duration": dur.isFinite ? dur : 0, "width": w, "height": h, "bytes": data.count])
        }
    }

    private func cleanup(_ urls: [URL]) {
        for u in urls { try? FileManager.default.removeItem(at: u) }
    }

    private func finish(error: String) {
        let call = pending
        pending = nil
        call?.reject(error)
    }
}

import Foundation
import Capacitor
import Photos
import UIKit
import AVKit
import QuickLook

// What the Photos page does with a photo on the phone that has it (PHOTOS_DESIGN.md
// §7, step 3). The page knows a photo by the phone's own id (its photo_sources row);
// everything here reads from or changes the phone's library, which with iCloud Photos
// on is the iCloud library.
//   • image({ id, size? })    → { path } — a screen-size JPEG in the app's caches,
//       for the photo view (pass it through Capacitor.convertFileSrc). iCloud-only
//       photos are fetched at that size.
//   • playVideo({ id })       — plays a video full screen (iCloud-only ones stream).
//   • share({ ids ≤20 })      — the share sheet with the originals (decision 10).
//   • favorite({ id, on })    — sets the Photos app's favourite.
//   • deletePhotos({ ids ≤100 }) → { deleted, missing } — deletes from the library; iOS asks
//       first and keeps them 30 days in Recently Deleted (decision 11). Rejects
//       CANCELLED if the person says no.
//   • markup({ id })          → { saved } — Apple's Markup over the photo; saving
//       stores the result as an edit of the photo, which Photos can revert.
// Each change also nudges the sync, so Liv's record and thumbnail follow.
extension PhotoLibraryPlugin {

    private func asset(_ id: String?) -> PHAsset? {
        guard let id = id, !id.isEmpty else { return nil }
        return PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject
    }

    private func writable(_ call: CAPPluginCall) -> Bool {
        let s = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if s == .authorized || s == .limited { return true }
        call.reject("Photo access is off for Live", "DENIED")
        return false
    }

    private static let cacheDir: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("live-photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    // Keeps the photo cache small: the newest 150 files.
    private func trimCache() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: Self.cacheDir, includingPropertiesForKeys: [.contentModificationDateKey]) , files.count > 150 else { return }
        let dated = files.map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
        for (url, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(150) { try? fm.removeItem(at: url) }
    }

    private func safeName(_ id: String) -> String {
        id.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
    }

    @objc func image(_ call: CAPPluginCall) {
        guard writable(call) else { return }
        guard let asset = asset(call.getString("id")) else { call.reject("Not on this phone", "MISSING"); return }
        let size = CGFloat(min(4096, max(256, call.getInt("size") ?? 2048)))
        let stamp = Int(asset.modificationDate?.timeIntervalSince1970 ?? 0)
        let file = Self.cacheDir.appendingPathComponent("\(safeName(asset.localIdentifier))-\(Int(size))-\(stamp).jpg")
        if FileManager.default.fileExists(atPath: file.path) { call.resolve(["path": file.absoluteString]); return }
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        options.version = .current
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: size, height: size), contentMode: .aspectFit, options: options) { [weak self] picture, info in
            if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
            guard let picture = picture, let data = picture.jpegData(compressionQuality: 0.85) else { call.reject("Couldn't read this photo", "UNREADABLE"); return }
            do {
                try data.write(to: file, options: .atomic)
                self?.trimCache()
                call.resolve(["path": file.absoluteString])
            } catch {
                call.reject("Couldn't read this photo", "UNREADABLE")
            }
        }
    }

    @objc func playVideo(_ call: CAPPluginCall) {
        guard writable(call) else { return }
        guard let asset = asset(call.getString("id")), asset.mediaType == .video else { call.reject("Not on this phone", "MISSING"); return }
        let options = PHVideoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .automatic
        PHImageManager.default().requestPlayerItem(forVideo: asset, options: options) { [weak self] item, _ in
            guard let item = item else { call.reject("Couldn't play this video", "UNREADABLE"); return }
            DispatchQueue.main.async {
                guard let host = self?.bridge?.viewController else { call.reject("No screen", "UNAVAILABLE"); return }
                let player = AVPlayer(playerItem: item)
                let controller = AVPlayerViewController()
                controller.player = player
                host.present(controller, animated: true) { player.play() }
                call.resolve()
            }
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        guard writable(call) else { return }
        let ids = (call.getArray("ids", String.self) ?? []).filter { !$0.isEmpty }
        guard !ids.isEmpty, ids.count <= 20 else { call.reject("Between 1 and 20 photos", "BAD_REQUEST"); return }
        let found = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var assets: [PHAsset] = []
        found.enumerateObjects { a, _, _ in assets.append(a) }
        guard !assets.isEmpty else { call.reject("Not on this phone", "MISSING"); return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            var urls: [URL] = []
            for asset in assets { if let url = self.exportOriginal(asset) { urls.append(url) } }
            DispatchQueue.main.async {
                guard !urls.isEmpty, let host = self.bridge?.viewController else { call.reject("Couldn't read these photos", "UNREADABLE"); return }
                let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = host.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.maxY - 40, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, _ in
                    for url in urls { try? FileManager.default.removeItem(at: url) }
                    call.resolve(["shared": completed])
                }
                host.present(sheet, animated: true)
            }
        }
    }

    // The photo as it is now (edits included), or the video, as a file to hand on.
    private func exportOriginal(_ asset: PHAsset) -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("live-share-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let sem = DispatchSemaphore(value: 0)
        var out: URL? = nil
        if asset.mediaType == .video {
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = true
            options.version = .current
            PHImageManager.default().requestExportSession(forVideo: asset, options: options, exportPreset: AVAssetExportPresetPassthrough) { session, _ in
                guard let session = session else { sem.signal(); return }
                let url = dir.appendingPathComponent("Video.mov")
                session.outputURL = url
                session.outputFileType = .mov
                session.exportAsynchronously {
                    if session.status == .completed { out = url }
                    sem.signal()
                }
            }
        } else {
            let options = PHImageRequestOptions()
            options.isNetworkAccessAllowed = true
            options.version = .current
            options.deliveryMode = .highQualityFormat
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, _ in
                if let data = data {
                    let ext = (uti ?? "").contains("heic") ? "heic" : ((uti ?? "").contains("png") ? "png" : "jpg")
                    let resource = PHAssetResource.assetResources(for: asset).first?.originalFilename
                    let base = ((resource ?? "Photo") as NSString).deletingPathExtension
                    let url = dir.appendingPathComponent("\(base).\(ext)")
                    if (try? data.write(to: url)) != nil { out = url }
                }
                sem.signal()
            }
        }
        sem.wait()
        return out
    }

    @objc func favorite(_ call: CAPPluginCall) {
        guard writable(call) else { return }
        guard let asset = asset(call.getString("id")) else { call.reject("Not on this phone", "MISSING"); return }
        let on = call.getBool("on") ?? true
        PHPhotoLibrary.shared().performChanges({
            PHAssetChangeRequest(for: asset).isFavorite = on
        }) { ok, _ in
            if ok { PhotoSyncEngine.shared.nudge(); call.resolve(["favorite": on]) } else { call.reject("Couldn't change it", "FAILED") }
        }
    }

    @objc func deletePhotos(_ call: CAPPluginCall) {
        guard writable(call) else { return }
        let ids = (call.getArray("ids", String.self) ?? []).filter { !$0.isEmpty }
        guard !ids.isEmpty, ids.count <= 100 else { call.reject("Between 1 and 100 photos", "BAD_REQUEST"); return }
        let found = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        guard found.count > 0 else { call.resolve(["deleted": [String](), "missing": ids]); return }
        var present: [String] = []
        found.enumerateObjects { a, _, _ in present.append(a.localIdentifier) }
        PHPhotoLibrary.shared().performChanges({
            PHAssetChangeRequest.deleteAssets(found)
        }) { ok, error in
            if ok {
                PhotoSyncEngine.shared.nudge()
                call.resolve(["deleted": present, "missing": ids.filter { !present.contains($0) }])
            } else {
                // 3072: the person tapped Don't Allow in iOS's own confirmation.
                call.reject("Not deleted", (error as NSError?)?.code == 3072 ? "CANCELLED" : "FAILED")
            }
        }
    }

    @objc func markup(_ call: CAPPluginCall) {
        guard writable(call) else { return }
        guard let asset = asset(call.getString("id")), asset.mediaType == .image else { call.reject("Not on this phone", "MISSING"); return }
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.version = .current
        options.deliveryMode = .highQualityFormat
        PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { [weak self] data, _, _, _ in
            guard let self = self, let data = data, let picture = UIImage(data: data), let jpeg = picture.jpegData(compressionQuality: 0.95) else {
                call.reject("Couldn't read this photo", "UNREADABLE"); return
            }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("live-markup-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent("Photo.jpg")
            guard (try? jpeg.write(to: file)) != nil else { call.reject("Couldn't read this photo", "UNREADABLE"); return }
            DispatchQueue.main.async {
                guard let host = self.bridge?.viewController else { call.reject("No screen", "UNAVAILABLE"); return }
                let session = MarkupSession(asset: asset, file: file, call: call)
                let preview = QLPreviewController()
                preview.dataSource = session
                preview.delegate = session
                session.retainSelf = session
                host.present(UINavigationController(rootViewController: preview), animated: true)
            }
        }
    }
}

// One Markup session: shows the photo in Quick Look with Markup on, and when the
// person saves, stores the result as an edit of the photo in the library.
final class MarkupSession: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    let asset: PHAsset
    let file: URL
    let call: CAPPluginCall
    var retainSelf: MarkupSession?
    // All on the main thread.
    private var saved = false
    private var saving = false
    private var dismissed = false
    private var finished = false

    init(asset: PHAsset, file: URL, call: CAPPluginCall) {
        self.asset = asset
        self.file = file
        self.call = call
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { file as NSURL }

    func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode {
        .createCopy
    }

    func previewController(_ controller: QLPreviewController, didSaveEditedCopyOf previewItem: QLPreviewItem, at modifiedContentsURL: URL) {
        DispatchQueue.main.async {
            self.saving = true
            self.saveEdit(from: modifiedContentsURL)
        }
    }

    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        // Quick Look can hand over the edited copy just after it closes: wait a moment,
        // and if a save is running, let it answer the call when it's done.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.dismissed = true
            if !self.saving { self.finish() }
        }
    }

    private func saveDone(_ ok: Bool) {
        DispatchQueue.main.async {
            if ok { self.saved = true; PhotoSyncEngine.shared.nudge() }
            self.saving = false
            if self.dismissed { self.finish() }
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        call.resolve(["saved": saved])
        retainSelf = nil
    }

    private func saveEdit(from url: URL) {
        guard let picture = UIImage(contentsOfFile: url.path), let jpeg = picture.jpegData(compressionQuality: 0.92) else { saveDone(false); return }
        let options = PHContentEditingInputRequestOptions()
        options.isNetworkAccessAllowed = true
        options.canHandleAdjustmentData = { _ in false }
        asset.requestContentEditingInput(with: options) { input, _ in
            guard let input = input else { self.saveDone(false); return }
            let output = PHContentEditingOutput(contentEditingInput: input)
            output.adjustmentData = PHAdjustmentData(formatIdentifier: "com.mrlukedevans.live.markup", formatVersion: "1", data: Data("markup".utf8))
            do { try jpeg.write(to: output.renderedContentURL, options: .atomic) } catch { self.saveDone(false); return }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest(for: self.asset).contentEditingOutput = output
            }) { ok, _ in self.saveDone(ok) }
        }
    }
}

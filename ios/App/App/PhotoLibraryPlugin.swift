import Foundation
import Capacitor
import Photos
import Network
import CryptoKit
import UIKit

// The phone's photo library, exposed as the "PhotoLibrary" plugin
// (native-bridge.js → nativePhotoLibrary()). PHOTOS_DESIGN.md §2, build step 1:
// count and probe. It only READS and COUNTS: no photo, thumbnail or file name leaves
// the phone, nothing is written, nothing is deleted. With iCloud Photos on, the
// phone's library is the iCloud library, so these are its numbers.
//   • status() → { access: "notDetermined" | "authorized" | "limited" | "denied" | "restricted" }
//   • probe()  → asks for access if it hasn't been asked, then walks the library on a
//       background queue and resolves with the counts (see `summary` below). Rejects
//       DENIED (access refused or restricted) or BUSY (a probe is already running).
//       Sends "photoProbeProgress" { done, total } every 500 items.
//   • cancel() → stops a running probe; its call rejects CANCELLED.
// For the first sync (PHOTOS_DESIGN.md §12 step 2) it also:
//   • deviceKey() → { key } — a stable, anonymous id for this install (a hash of the
//       vendor id), so the same photo on this phone is always the same record.
//   • list({ offset, limit, since? }) → { total, items } — the library's details in
//       pages, oldest first (new photos land at the end, so paging never skips one).
//       `since` (ms) keeps only photos added or changed after it. No pixels.
//   • thumbs({ ids, size?, quality? }) → { items: [{ id, b64, width, height }] } —
//       small JPEGs (longest side `size`, default 400) made on the phone; a video
//       gives its poster frame. An id it can't read comes back with `error`.
//   • status() also says whether the network is expensive (cellular / hotspot).
// Sizes and "is the original on this phone" come from PHAssetResource's `fileSize`
// and `locallyAvailable`, which Apple doesn't document; both are read only when the
// object answers to them, and a resource without them is counted under sizeUnknown.
// Hidden photos are not included (iOS leaves them out unless asked).
@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deviceKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "thumbs", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "live.photos.probe", qos: .utility)
    private let lock = NSLock()
    private var running = false
    private var cancelled = false
    private let pathMonitor = NWPathMonitor()
    private var expensive = false

    public override func load() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            self.lock.lock(); self.expensive = path.isExpensive; self.lock.unlock()
        }
        pathMonitor.start(queue: DispatchQueue(label: "live.photos.path"))
    }

    private func accessName(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        lock.lock(); let isExpensive = expensive; lock.unlock()
        call.resolve(["access": accessName(PHPhotoLibrary.authorizationStatus(for: .readWrite)), "expensive": isExpensive])
    }

    @objc func deviceKey(_ call: CAPPluginCall) {
        guard let vendor = UIDevice.current.identifierForVendor?.uuidString else {
            call.reject("No device id", "UNAVAILABLE"); return
        }
        let digest = SHA256.hash(data: Data("live-photos|\(vendor)".utf8))
        let key = digest.map { String(format: "%02x", $0) }.joined().prefix(32)
        call.resolve(["key": String(key)])
    }

    private func readable() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }

    @objc func list(_ call: CAPPluginCall) {
        guard readable() else { call.reject("Photo access is off for Live", "DENIED"); return }
        let offset = max(0, call.getInt("offset") ?? 0)
        let limit = min(1000, max(1, call.getInt("limit") ?? 500))
        let since = call.getDouble("since")
        queue.async { [weak self] in
            guard let self = self else { return }
            let options = PHFetchOptions()
            options.includeHiddenAssets = false
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            if let since = since, since > 0 {
                let date = Date(timeIntervalSince1970: since / 1000)
                options.predicate = NSPredicate(format: "modificationDate > %@ OR creationDate > %@", date as NSDate, date as NSDate)
            }
            let assets = PHAsset.fetchAssets(with: options)
            let total = assets.count
            var items: [[String: Any]] = []
            if offset < total {
                let end = min(total, offset + limit)
                let iso = ISO8601DateFormatter()
                assets.enumerateObjects(at: IndexSet(integersIn: offset..<end), options: []) { asset, _, _ in
                    autoreleasepool {
                        var item: [String: Any] = [
                            "id": asset.localIdentifier,
                            "kind": asset.mediaType == .video ? "video" : "photo",
                            "screenshot": asset.mediaSubtypes.contains(.photoScreenshot),
                            "live": asset.mediaSubtypes.contains(.photoLive),
                            "favorite": asset.isFavorite,
                            "width": asset.pixelWidth,
                            "height": asset.pixelHeight,
                        ]
                        if asset.mediaType == .video { item["duration"] = asset.duration }
                        if let burst = asset.burstIdentifier { item["burst"] = burst }
                        if let made = asset.creationDate { item["taken"] = iso.string(from: made) }
                        if let loc = asset.location {
                            item["lat"] = loc.coordinate.latitude
                            item["lng"] = loc.coordinate.longitude
                        }
                        var bytes: Int64 = 0
                        var sized = false
                        for resource in PHAssetResource.assetResources(for: asset) {
                            if let b = self.size(of: resource) { bytes += b; sized = true }
                        }
                        if sized { item["bytes"] = Double(bytes) }
                        items.append(item)
                    }
                }
            }
            call.resolve(["total": total, "items": items])
        }
    }

    @objc func thumbs(_ call: CAPPluginCall) {
        guard readable() else { call.reject("Photo access is off for Live", "DENIED"); return }
        let ids = (call.getArray("ids", String.self) ?? []).filter { !$0.isEmpty }
        guard !ids.isEmpty, ids.count <= 60 else { call.reject("Between 1 and 60 ids", "BAD_REQUEST"); return }
        let size = CGFloat(min(1024, max(64, call.getInt("size") ?? 400)))
        let quality = CGFloat(min(0.95, max(0.3, call.getDouble("quality") ?? 0.72)))
        queue.async {
            let found = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            var byId: [String: PHAsset] = [:]
            found.enumerateObjects { asset, _, _ in byId[asset.localIdentifier] = asset }
            let manager = PHImageManager.default()
            let options = PHImageRequestOptions()
            options.isSynchronous = true
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .fast
            options.isNetworkAccessAllowed = true
            options.version = .current
            var out: [[String: Any]] = []
            for id in ids {
                autoreleasepool {
                    guard let asset = byId[id] else { out.append(["id": id, "error": "missing"]); return }
                    var image: UIImage? = nil
                    manager.requestImage(for: asset, targetSize: CGSize(width: size, height: size), contentMode: .aspectFit, options: options) { result, _ in
                        image = result
                    }
                    guard let picture = image, let data = picture.jpegData(compressionQuality: quality) else {
                        out.append(["id": id, "error": "unreadable"]); return
                    }
                    let px = picture.size.applying(CGAffineTransform(scaleX: picture.scale, y: picture.scale))
                    out.append(["id": id, "b64": data.base64EncodedString(), "width": Int(px.width.rounded()), "height": Int(px.height.rounded())])
                }
            }
            call.resolve(["items": out])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        lock.lock(); cancelled = true; lock.unlock()
        call.resolve()
    }

    @objc func probe(_ call: CAPPluginCall) {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if current == .notDetermined {
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] granted in
                self?.start(call, status: granted)
            }
        } else {
            start(call, status: current)
        }
    }

    private func start(_ call: CAPPluginCall, status: PHAuthorizationStatus) {
        guard status == .authorized || status == .limited else {
            call.reject("Photo access is off for Live", "DENIED")
            return
        }
        lock.lock()
        if running { lock.unlock(); call.reject("A count is already running", "BUSY"); return }
        running = true
        cancelled = false
        lock.unlock()
        queue.async { [weak self] in
            guard let self = self else { return }
            let result = self.walk(access: self.accessName(status))
            self.lock.lock(); self.running = false; self.lock.unlock()
            if let result = result { call.resolve(result) } else { call.reject("Stopped", "CANCELLED") }
        }
    }

    private func isCancelled() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelled
    }

    private static let fileSizeSelector = NSSelectorFromString("fileSize")
    private static let locallyAvailableSelector = NSSelectorFromString("locallyAvailable")

    private func size(of resource: PHAssetResource) -> Int64? {
        guard resource.responds(to: PhotoLibraryPlugin.fileSizeSelector) else { return nil }
        return (resource.value(forKey: "fileSize") as? NSNumber)?.int64Value
    }

    private func isLocal(_ resource: PHAssetResource) -> Bool? {
        guard resource.responds(to: PhotoLibraryPlugin.locallyAvailableSelector) else { return nil }
        return (resource.value(forKey: "locallyAvailable") as? NSNumber)?.boolValue
    }

    // The resource that is "the original" for the on-phone / iCloud-only count.
    private func isPrimary(_ type: PHAssetResourceType, for asset: PHAsset) -> Bool {
        switch asset.mediaType {
        case .video: return type == .video
        case .image: return type == .photo
        default: return false
        }
    }

    private func walk(access: String) -> [String: Any]? {
        let started = Date()
        let options = PHFetchOptions()
        options.includeHiddenAssets = false
        let assets = PHAsset.fetchAssets(with: options)
        let total = assets.count

        var photos = 0, videos = 0, other = 0
        var screenshots = 0, livePhotos = 0, bursts = 0, favorites = 0, withLocation = 0
        var videoSeconds = 0.0
        var bytesPhotos: Int64 = 0, bytesVideos: Int64 = 0, bytesScreenshots: Int64 = 0
        var originalsLocal = 0, originalsCloudOnly = 0, originalsUnknown = 0, sizeUnknown = 0
        var oldest: Date? = nil, newest: Date? = nil
        var byYear: [String: Int] = [:]
        let calendar = Calendar(identifier: .gregorian)
        var stopped = false

        assets.enumerateObjects { asset, index, stop in
            if index % 100 == 0, self.isCancelled() { stopped = true; stop.pointee = true; return }
            autoreleasepool {
                let isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)
                switch asset.mediaType {
                case .image: photos += 1
                case .video: videos += 1; videoSeconds += asset.duration
                default: other += 1
                }
                if isScreenshot { screenshots += 1 }
                if asset.mediaSubtypes.contains(.photoLive) { livePhotos += 1 }
                if asset.burstIdentifier != nil { bursts += 1 }
                if asset.isFavorite { favorites += 1 }
                if asset.location != nil { withLocation += 1 }
                if let made = asset.creationDate {
                    if oldest == nil || made < oldest! { oldest = made }
                    if newest == nil || made > newest! { newest = made }
                    byYear[String(calendar.component(.year, from: made)), default: 0] += 1
                }

                var assetBytes: Int64 = 0
                var sized = false
                var local: Bool? = nil
                for resource in PHAssetResource.assetResources(for: asset) {
                    if let bytes = self.size(of: resource) { assetBytes += bytes; sized = true }
                    if self.isPrimary(resource.type, for: asset), local == nil { local = self.isLocal(resource) }
                }
                if !sized { sizeUnknown += 1 }
                if asset.mediaType == .video { bytesVideos += assetBytes } else { bytesPhotos += assetBytes }
                if isScreenshot { bytesScreenshots += assetBytes }
                switch local {
                case .some(true): originalsLocal += 1
                case .some(false): originalsCloudOnly += 1
                case .none: originalsUnknown += 1
                }
            }
            if (index + 1) % 500 == 0 {
                self.notifyListeners("photoProbeProgress", data: ["done": index + 1, "total": total])
            }
        }
        if stopped { return nil }

        let iso = ISO8601DateFormatter()
        var summary: [String: Any] = [
            "access": access,
            "total": total,
            "photos": photos,
            "videos": videos,
            "other": other,
            "screenshots": screenshots,
            "livePhotos": livePhotos,
            "bursts": bursts,
            "favorites": favorites,
            "withLocation": withLocation,
            "videoSeconds": videoSeconds,
            // Doubles: a library can pass what a 32-bit JS integer holds.
            "bytesPhotos": Double(bytesPhotos),
            "bytesVideos": Double(bytesVideos),
            "bytesScreenshots": Double(bytesScreenshots),
            "originalsLocal": originalsLocal,
            "originalsCloudOnly": originalsCloudOnly,
            "originalsUnknown": originalsUnknown,
            "sizeUnknown": sizeUnknown,
            "byYear": byYear,
            "seconds": Date().timeIntervalSince(started)
        ]
        if let oldest = oldest { summary["oldest"] = iso.string(from: oldest) }
        if let newest = newest { summary["newest"] = iso.string(from: newest) }
        return summary
    }
}

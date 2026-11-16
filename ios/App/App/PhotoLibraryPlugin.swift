import Foundation
import Capacitor
import Photos

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
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "live.photos.probe", qos: .utility)
    private let lock = NSLock()
    private var running = false
    private var cancelled = false

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
        call.resolve(["access": accessName(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
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

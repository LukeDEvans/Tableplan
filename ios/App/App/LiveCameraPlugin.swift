import Foundation
import Capacitor
import UIKit
import Photos
import UniformTypeIdentifiers

// The utilities menu's Camera (UTILITIES_MENU_DESIGN.md §6), exposed as the
// "LiveCamera" plugin (native-bridge.js → nativeCamera()). It opens the iPhone's
// own camera (photo or video) and saves what you take to the photo library, from
// where the Photos page picks it up through its normal sync. No camera of our own.
//   • capture() → { saved: true, kind: "photo" | "video" } | { cancelled: true };
//     rejects "DENIED" without camera or photo-library permission,
//     "UNAVAILABLE" with no camera.
@objc(LiveCameraPlugin)
public class LiveCameraPlugin: CAPPlugin, CAPBridgedPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public let identifier = "LiveCameraPlugin"
    public let jsName = "LiveCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    @objc func capture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                call.reject("No camera on this device", "UNAVAILABLE")
                return
            }
            if let old = self.pending { old.resolve(["cancelled": true]) }
            self.pending = call
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
            picker.videoQuality = .typeHigh
            picker.delegate = self
            picker.modalPresentationStyle = .fullScreen
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        pending?.resolve(["cancelled": true])
        pending = nil
    }

    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard let call = pending else { return }
        pending = nil
        let image = info[.originalImage] as? UIImage
        let movie = info[.mediaURL] as? URL
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Saving to Photos is off for this app in Settings", "DENIED")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                if let movie = movie {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: movie)
                } else if let image = image {
                    PHAssetChangeRequest.creationRequestForAsset(from: image)
                }
            }) { ok, error in
                if ok { call.resolve(["saved": true, "kind": movie != nil ? "video" : "photo"]) }
                else { call.reject(error?.localizedDescription ?? "Couldn't save to Photos", "SAVE_FAILED") }
            }
        }
    }
}

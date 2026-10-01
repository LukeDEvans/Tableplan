import Foundation
import UIKit
import VisionKit
import Capacitor

// Receipt camera for the header scanner, exposed to the web app as the
// "DocumentScanner" plugin (native-bridge.js → nativeDocumentScanner()).
//
// Uses Apple's document camera (VisionKit, the scanner Notes and Files use):
// it finds the receipt's edges, straightens and crops it, and takes several
// pages for a long receipt. The pages come back to the web app as JPEG
// base64; nothing is written to the Photos library.
//   • isAvailable() — { available } (false on devices without a camera).
//   • scan({ maxPages, maxDimension, quality }) — presents the camera and
//     resolves { pages: [base64 JPEG…], cancelled }.
@objc(DocumentScannerPlugin)
public class DocumentScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "DocumentScannerPlugin"
    public let jsName = "DocumentScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var maxPages = 4
    private var maxDimension: CGFloat = 1600
    private var quality: CGFloat = 0.82

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": VNDocumentCameraViewController.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("The document camera isn't available on this device.")
            return
        }
        maxPages = max(1, min(call.getInt("maxPages") ?? 4, 10))
        maxDimension = CGFloat(max(600, min(call.getInt("maxDimension") ?? 1600, 4000)))
        quality = CGFloat(max(0.3, min(call.getDouble("quality") ?? 0.82, 1.0)))
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.pendingCall != nil {
                call.reject("A scan is already open.")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view to present from.")
                return
            }
            self.pendingCall = call
            let camera = VNDocumentCameraViewController()
            camera.delegate = self
            presenter.present(camera, animated: true)
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let count = min(scan.pageCount, maxPages)
        let images = (0..<count).map { scan.imageOfPage(at: $0) }
        let maxDimension = self.maxDimension
        let quality = self.quality
        controller.dismiss(animated: true)
        // Resize + encode off the main thread; a multi-page scan can take a moment.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let pages = images.compactMap { DocumentScannerPlugin.jpegBase64($0, maxDimension: maxDimension, quality: quality) }
            DispatchQueue.main.async {
                self?.finish(["pages": pages, "cancelled": false])
            }
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        finish(["pages": [String](), "cancelled": true])
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        let call = pendingCall
        pendingCall = nil
        call?.reject(error.localizedDescription)
    }

    private func finish(_ result: [String: Any]) {
        let call = pendingCall
        pendingCall = nil
        call?.resolve(result)
    }

    private static func jpegBase64(_ image: UIImage, maxDimension: CGFloat, quality: CGFloat) -> String? {
        let size = image.size
        let longest = max(size.width, size.height)
        var output = image
        if longest > maxDimension, longest > 0 {
            let scale = maxDimension / longest
            let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            output = UIGraphicsImageRenderer(size: target, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: target))
            }
        }
        return output.jpegData(compressionQuality: quality)?.base64EncodedString()
    }
}

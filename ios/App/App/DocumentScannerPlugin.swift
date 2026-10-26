import Foundation
import UIKit
import VisionKit
import Vision
import Capacitor

// Receipt camera for the header scanner, exposed to the web app as the
// "DocumentScanner" plugin (native-bridge.js → nativeDocumentScanner()).
//
// Uses Apple's document camera (VisionKit, the scanner Notes and Files use):
// it finds the receipt's edges, straightens and crops it, and takes several
// pages for a long receipt. The pages come back to the web app as JPEG
// base64; nothing is written to the Photos library.
//   • isAvailable() — { available } (false on devices without a camera).
//   • scan({ maxPages, maxDimension, quality, ocr }) — presents the camera and
//     resolves { pages: [base64 JPEG…], cancelled, text? }. With ocr: true it also
//     runs Apple's on-device text recognition on each page and returns
//     text: [[{ text, x, y, w, h }…] per page] (0–1 page coordinates, top-left
//     origin). The app rebuilds printed rows from these (receipt-reconcile.js) and
//     uses the exact digits to check the AI's read (RECEIPTS.md, "Reading a receipt").
//   • recognizeText({ images: [base64 JPEG…] }) — the same text recognition for
//     photos picked from the library; resolves { text: [[…] per image] }.
@objc(DocumentScannerPlugin)
public class DocumentScannerPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "DocumentScannerPlugin"
    public let jsName = "DocumentScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var maxPages = 4
    private var maxDimension: CGFloat = 1600
    private var quality: CGFloat = 0.82
    private var wantsText = false

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
        wantsText = call.getBool("ocr") ?? false
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
        let wantsText = self.wantsText
        controller.dismiss(animated: true)
        // Resize + encode (and read the text) off the main thread; a multi-page
        // scan can take a moment.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let pages = images.compactMap { DocumentScannerPlugin.jpegBase64($0, maxDimension: maxDimension, quality: quality) }
            var result: [String: Any] = ["pages": pages, "cancelled": false]
            if wantsText {
                result["text"] = images.map { DocumentScannerPlugin.recognize($0.cgImage) }
            }
            DispatchQueue.main.async {
                self?.finish(result)
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

    @objc func recognizeText(_ call: CAPPluginCall) {
        let encoded = (call.getArray("images") as? [String]) ?? []
        DispatchQueue.global(qos: .userInitiated).async {
            let text: [[[String: Any]]] = encoded.prefix(6).map { b64 -> [[String: Any]] in
                guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
                      let image = UIImage(data: data) else { return [] }
                return DocumentScannerPlugin.recognize(image.cgImage)
            }
            DispatchQueue.main.async { call.resolve(["text": text]) }
        }
    }

    // Apple's on-device text recognition (Vision), accurate mode, no language
    // correction (it would "fix" product codes and prices). Each observation's
    // box is flipped to a top-left origin for the web side.
    private static func recognize(_ cgImage: CGImage?) -> [[String: Any]] {
        guard let cgImage = cgImage else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do { try handler.perform([request]) } catch { return [] }
        let observations = request.results ?? []
        return observations.compactMap { obs -> [String: Any]? in
            guard let candidate = obs.topCandidates(1).first else { return nil }
            let box = obs.boundingBox
            return [
                "text": candidate.string,
                "x": Double(box.minX),
                "y": Double(1 - box.maxY),
                "w": Double(box.width),
                "h": Double(box.height)
            ]
        }
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

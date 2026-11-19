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
//   • scan({ …, pdf: true }) — for Documents (DOCUMENTS_DESIGN.md §9): up to 30
//     pages, joined on the phone into one PDF; resolves { pdf: base64, pageCount,
//     thumb: small JPEG of page 1, pageText: [string per page] (with ocr), cancelled }.
//     No page images are returned and nothing touches Photos or the disk.
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
    private var wantsPdf = false

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": VNDocumentCameraViewController.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("The document camera isn't available on this device.")
            return
        }
        wantsPdf = call.getBool("pdf") ?? false
        maxPages = max(1, min(call.getInt("maxPages") ?? 4, wantsPdf ? 30 : 10))
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
        let maxDimension = self.maxDimension
        let quality = self.quality
        let wantsText = self.wantsText
        let wantsPdf = self.wantsPdf
        controller.dismiss(animated: true)
        if wantsPdf {
            // One page at a time, each inside its own autorelease pool: load it, shrink
            // it, write it into the PDF, read its text from the shrunk copy, let it go.
            // Holding 30 full-resolution pages at once could run the phone out of memory.
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let built = DocumentScannerPlugin.buildPdf(scan, count: count, maxDimension: maxDimension, quality: quality, wantsText: wantsText)
                var result: [String: Any] = ["cancelled": false, "pageCount": built.pages]
                if let pdf = built.pdf { result["pdf"] = pdf.base64EncodedString() }
                if let thumb = built.thumb { result["thumb"] = thumb.base64EncodedString() }
                if wantsText { result["pageText"] = built.text }
                DispatchQueue.main.async { self?.finish(result) }
            }
            return
        }
        let images = (0..<count).map { scan.imageOfPage(at: $0) }
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

    private static func shrink(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        guard longest > maxDimension, longest > 0 else { return image }
        let scale = maxDimension / longest
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
    }

    // One PDF, a page per scanned page (page size = the shrunk image's pixels in
    // points, the image JPEG-compressed inside), plus a small JPEG of page 1 and the
    // text read from each page.
    private static func buildPdf(_ scan: VNDocumentCameraScan, count: Int, maxDimension: CGFloat, quality: CGFloat, wantsText: Bool) -> (pdf: Data?, thumb: Data?, text: [String], pages: Int) {
        let data = NSMutableData()
        var thumb: Data?
        var text: [String] = []
        var pages = 0
        UIGraphicsBeginPDFContextToData(data, .zero, [kCGPDFContextCreator as String: "Live"])
        for index in 0..<count {
            autoreleasepool {
                let small = shrink(scan.imageOfPage(at: index), maxDimension: maxDimension)
                guard let jpeg = small.jpegData(compressionQuality: quality), let compressed = UIImage(data: jpeg) else { return }
                UIGraphicsBeginPDFPageWithInfo(CGRect(origin: .zero, size: small.size), nil)
                compressed.draw(in: CGRect(origin: .zero, size: small.size))
                pages += 1
                if index == 0 { thumb = shrink(small, maxDimension: 320).jpegData(compressionQuality: 0.72) }
                if wantsText { text.append(recognize(small.cgImage).compactMap { $0["text"] as? String }.joined(separator: "\n")) }
            }
        }
        UIGraphicsEndPDFContext()
        return (pages > 0 && data.length > 0 ? data as Data : nil, thumb, text, pages)
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

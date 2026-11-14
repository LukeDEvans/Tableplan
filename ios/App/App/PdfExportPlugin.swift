import UIKit
import WebKit
import Capacitor

// The word processor's PDF on the iPhone (WORD_PROCESSOR_DESIGN.md §9), exposed as the
// "PdfExport" plugin (native-bridge.js → nativePdfExport()). The page has already put
// the laid-out pages in a print-only box (documents/editor/pdf-export.js, one
// page-sized box per page with print CSS); this renders the web view's print output
// to PDF data at the document's page size, with no margins of its own, and returns
// it as base64. The JS hands the file to the share sheet. Nothing is written to disk.
//   • render({ widthPt, heightPt }) → { pdf: base64, pages }
@objc(PdfExportPlugin)
public class PdfExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PdfExportPlugin"
    public let jsName = "PdfExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise)
    ]

    @objc func render(_ call: CAPPluginCall) {
        let w = call.getDouble("widthPt") ?? 612
        let h = call.getDouble("heightPt") ?? 792
        guard w >= 100, w <= 2000, h >= 100, h <= 3000 else {
            call.reject("Bad page size")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.bridge?.webView else {
                call.reject("No web view")
                return
            }
            let paper = CGRect(x: 0, y: 0, width: w, height: h)
            let renderer = UIPrintPageRenderer()
            renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
            renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
            renderer.setValue(NSValue(cgRect: paper), forKey: "printableRect")
            renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
            let data = NSMutableData()
            UIGraphicsBeginPDFContextToData(data, paper, nil)
            let count = renderer.numberOfPages
            for i in 0..<count {
                UIGraphicsBeginPDFPage()
                renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
            }
            UIGraphicsEndPDFContext()
            call.resolve(["pdf": data.base64EncodedString(), "pages": count])
        }
    }
}

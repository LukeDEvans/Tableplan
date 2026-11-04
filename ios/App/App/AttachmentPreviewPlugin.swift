import UIKit
import Capacitor
import QuickLook
import UniformTypeIdentifiers

// Opens an email attachment inside the app with Quick Look (the viewer Mail and
// Files use), exposed as the "AttachmentPreview" plugin
// (native-bridge.js → nativeAttachmentPreview(); mail-attachment-view.js).
//
//   • open({ url, token, messageId, attachmentId, filename, mimeType })
//       Downloads the file itself — POST to gmail-attachment with the Supabase
//       session as the bearer — so megabytes never cross the JS bridge, then
//       presents Quick Look. Rejects "NOT_DEPLOYED" on 404 (the function isn't
//       live yet → the app falls back to openData), "TOO_LARGE" on 413.
//   • openData({ data, filename, mimeType, sensitive })
//       The same viewer for bytes the web side already has (base64). sensitive:
//       a decrypted Documents file (DOCUMENTS_DESIGN.md §9) — up to 40 MB (the
//       bytes cross the bridge as base64, so the cap keeps memory in check), its
//       temp copy written with complete file protection, and the viewer is closed
//       (and the copy deleted) the moment the app stops being active (the app
//       switcher, Control Centre, a call, the background), so nothing stays on
//       screen or in the switcher's snapshot after Documents locks. A request that
//       arrives while the app isn't active is refused ("INACTIVE") and nothing is
//       written. Leftover copies from a crash are cleared when the app starts.
//
// Quick Look renders PDF, images, Word/Excel/PowerPoint, Pages/Numbers/Keynote,
// text, CSV, RTF, audio/video and more, outside the web view (so sender-supplied
// HTML can't touch the app's session), and has its own Share button for Save to
// Files / AirDrop / other apps. The temp copy is deleted when the viewer closes.
@objc(AttachmentPreviewPlugin)
public class AttachmentPreviewPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    public let identifier = "AttachmentPreviewPlugin"
    public let jsName = "AttachmentPreview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openData", returnType: CAPPluginReturnPromise)
    ]

    private var previewURL: URL?
    private var previewSensitive = false
    private weak var previewController: QLPreviewController?
    private static let maxBytes = 20_000_000
    private static let maxSensitiveBytes = 40_000_000

    override public func load() {
        // Copies left behind if the app was killed with a preview open.
        try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("attachments", isDirectory: true))
        NotificationCenter.default.addObserver(self, selector: #selector(appStoppedBeingActive), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appStoppedBeingActive), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    // Posted on the main thread: closes a sensitive viewer at once (no animation), so
    // the switcher's snapshot never shows it.
    @objc private func appStoppedBeingActive() {
        guard previewSensitive else { return }
        previewController?.dismiss(animated: false)
        cleanUp()
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              url.scheme == "https",
              let token = call.getString("token"), !token.isEmpty,
              let messageId = call.getString("messageId"), let attachmentId = call.getString("attachmentId") else {
            call.reject("url, token, messageId and attachmentId are required", "INVALID")
            return
        }
        let filename = call.getString("filename") ?? "attachment"
        let mimeType = call.getString("mimeType") ?? ""

        var request = URLRequest(url: url, timeoutInterval: 90)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "messageId": messageId, "attachmentId": attachmentId, "filename": filename
        ])

        URLSession.shared.downloadTask(with: request) { [weak self] tmp, response, error in
            guard let self = self else { return }
            if let error = error {
                call.reject(error.localizedDescription, "FAILED")
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 404 { call.reject("Attachment viewer not deployed yet", "NOT_DEPLOYED"); return }
            if status == 413 { call.reject("Attachment too large to open here", "TOO_LARGE"); return }
            guard status == 200, let tmp = tmp else {
                var message = "Couldn't download the attachment (\(status))."
                if let tmp = tmp, let data = try? Data(contentsOf: tmp),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let err = obj["error"] as? String {
                    message = err
                }
                call.reject(message, "FAILED")
                return
            }
            do {
                let dest = try self.prepareDestination(filename: filename, mimeType: mimeType)
                try FileManager.default.moveItem(at: tmp, to: dest)
                self.present(dest, call)
            } catch {
                call.reject(error.localizedDescription, "FAILED")
            }
        }.resume()
    }

    @objc func openData(_ call: CAPPluginCall) {
        let sensitive = call.getBool("sensitive") ?? false
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64), data.count <= (sensitive ? Self.maxSensitiveBytes : Self.maxBytes) else {
            call.reject("data (base64) is required", "INVALID")
            return
        }
        let filename = call.getString("filename") ?? "attachment"
        let mimeType = call.getString("mimeType") ?? ""
        // Sensitive: decided, written and shown in one go on the main thread, with the
        // app active, so a lock can't fall between the check and the viewer appearing.
        if sensitive {
            DispatchQueue.main.async {
                guard UIApplication.shared.applicationState == .active else {
                    call.reject("The app isn't open", "INACTIVE")
                    return
                }
                do {
                    let dest = try self.prepareDestination(filename: filename, mimeType: mimeType)
                    try data.write(to: dest, options: [.atomic, .completeFileProtection])
                    self.present(dest, call, sensitive: true)
                } catch {
                    call.reject(error.localizedDescription, "FAILED")
                }
            }
            return
        }
        do {
            let dest = try prepareDestination(filename: filename, mimeType: mimeType)
            try data.write(to: dest, options: .atomic)
            present(dest, call)
        } catch {
            call.reject(error.localizedDescription, "FAILED")
        }
    }

    // A fresh folder per file keeps the real filename (Quick Look and Share use
    // it) without clashing; the extension is added from the type when missing.
    private func prepareDestination(filename: String, mimeType: String) throws -> URL {
        var name = filename.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name.hasPrefix(".") { name = "attachment" + name }
        if (name as NSString).pathExtension.isEmpty,
           let ext = UTType(mimeType: mimeType)?.preferredFilenameExtension {
            name += ".\(ext)"
        }
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("attachments", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(name)
    }

    private func present(_ url: URL, _ call: CAPPluginCall, sensitive: Bool = false) {
        let show = {
            guard let presenter = self.bridge?.viewController else {
                try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
                call.reject("No view to present from", "FAILED")
                return
            }
            self.cleanUp()
            self.previewURL = url
            self.previewSensitive = sensitive
            let ql = QLPreviewController()
            self.previewController = ql
            ql.dataSource = self
            ql.delegate = self
            var top = presenter
            while let next = top.presentedViewController { top = next }
            top.present(ql, animated: true) {
                call.resolve(["opened": true])
            }
        }
        if Thread.isMainThread { show() } else { DispatchQueue.main.async(execute: show) }
    }

    private func cleanUp() {
        if let url = previewURL {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        previewURL = nil
        previewSensitive = false
    }

    // MARK: QLPreviewControllerDataSource / Delegate

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewURL == nil ? 0 : 1
    }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (previewURL ?? URL(fileURLWithPath: "/dev/null")) as NSURL
    }

    public func previewControllerDidDismiss(_ controller: QLPreviewController) {
        cleanUp()
    }
}

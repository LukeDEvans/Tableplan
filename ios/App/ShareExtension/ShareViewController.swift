import UIKit
import ImageIO
import PDFKit
import UniformTypeIdentifiers

// "Live" in the iOS share sheet for order screenshots and order-summary PDFs:
// share up to 4 screenshots of an online order (Amazon order details, "Your
// Orders", …) or one PDF (Amazon's detailed "Order Summary" → Save), and they go
// straight to Finance. RECEIPTS.md → "Share sheet".
//
// A PDF is read on the phone with PDFKit: its text is sent (small and exact —
// the model reads every line of the invoice). A PDF with no text layer (a scan)
// is sent as page images instead, like screenshots.
//
// The extension uploads directly to the share-receipt Netlify function with the
// share token the app left in the shared keychain (ShareTokenStore), so nothing
// waits for the app to open. Finance imports the result into the receipts list
// the next time it loads its inbox (on open or when the app comes back).
final class ShareViewController: UIViewController {
    private static let endpoint = URL(string: "https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/share-receipt")!
    private static let maxImages = 4
    private static let maxPdfPages = 6
    private static let maxPdfText = 40000
    private static let minPdfText = 80

    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let doneButton = UIButton(type: .system)
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
        show(title: "Sending to Finance…", detail: "Reading the order", busy: true)
        Task { await run() }
    }

    // MARK: - Flow

    private func run() async {
        guard let token = ShareTokenStore.load() else {
            finish(title: "Open Live first", detail: "Open the Live app and sign in once, then share again.", autoClose: false)
            return
        }
        var images: [Data] = []
        var text: String? = nil
        if let pdf = await loadPDF() {
            let pdfText = Self.text(of: pdf)
            if pdfText.count >= Self.minPdfText {
                text = pdfText
            } else {
                images = Self.pageImages(of: pdf)
            }
        } else {
            images = await loadImages()
        }
        guard !images.isEmpty || text != nil else {
            finish(title: "Nothing to read", detail: "Share a screenshot of the order or its order-summary PDF.", autoClose: false)
            return
        }
        do {
            let result = try await upload(images: images, text: text, token: token)
            finish(title: result.title, detail: result.detail, autoClose: result.ok)
        } catch {
            finish(title: "Couldn't send", detail: "Check your connection and share again.", autoClose: false)
        }
    }

    private struct Outcome { let ok: Bool; let title: String; let detail: String }

    private func upload(images: [Data], text: String?, token: String) async throws -> Outcome {
        var request = URLRequest(url: Self.endpoint, timeoutInterval: 90)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        var payload: [String: Any] = [
            "action": "share",
            "images": images.map { "data:image/jpeg;base64,\($0.base64EncodedString())" }
        ]
        if let text {
            payload["text"] = text
            payload["kind"] = "summary"
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]

        guard status == 200 else {
            let message = json["error"] as? String ?? "Something went wrong (\(status))."
            return Outcome(ok: false, title: "Couldn't add it", detail: message)
        }
        let receipts = json["receipts"] as? [[String: Any]] ?? []
        if receipts.isEmpty {
            return Outcome(ok: false, title: "No order found", detail: "Try a screenshot or summary that shows the order total.")
        }
        if receipts.count == 1, let r = receipts.first {
            return Outcome(ok: true, title: "Added to Finance", detail: Self.describe(r))
        }
        let lines = receipts.prefix(4).map(Self.describe).joined(separator: "\n")
        return Outcome(ok: true, title: "Added \(receipts.count) orders", detail: lines)
    }

    private static func describe(_ r: [String: Any]) -> String {
        let merchant = (r["merchant"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Order"
        let total = (r["total"] as? NSNumber)?.doubleValue ?? 0
        let money = NumberFormatter.localizedString(from: NSNumber(value: total), number: .currency)
        var parts = ["\(merchant) · \(money)"]
        if let iso = r["date"] as? String, let date = isoDay.date(from: iso) {
            parts.append(shortDay.string(from: date))
        }
        return parts.joined(separator: " · ")
    }

    private static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let shortDay: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return f
    }()

    // MARK: - Attachments

    // The first shared PDF, if any. Apps hand it over as a file URL or as data.
    private func loadPDF() async -> PDFDocument? {
        let provider = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
            .first { $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) }
        guard let provider else { return nil }
        return await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.pdf.identifier, options: nil) { item, _ in
                var doc: PDFDocument?
                if let url = item as? URL {
                    doc = PDFDocument(url: url)
                } else if let data = item as? Data {
                    doc = PDFDocument(data: data)
                }
                continuation.resume(returning: doc)
            }
        }
    }

    // Text of the first pages, page by page, capped.
    static func text(of doc: PDFDocument) -> String {
        var pages: [String] = []
        for i in 0..<min(doc.pageCount, maxPdfPages) {
            if let s = doc.page(at: i)?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
                pages.append(s)
            }
        }
        return String(pages.joined(separator: "\n\n--- page ---\n\n").prefix(maxPdfText))
    }

    // A PDF without a text layer (scanned): its first pages as JPEGs.
    static func pageImages(of doc: PDFDocument) -> [Data] {
        (0..<min(doc.pageCount, maxImages)).compactMap { i in
            guard let page = doc.page(at: i) else { return nil }
            let bounds = page.bounds(for: .mediaBox)
            let longest = max(bounds.width, bounds.height)
            guard longest > 0 else { return nil }
            let scale = ShareImage.maxPixelSize / longest
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
            return page.thumbnail(of: size, for: .mediaBox).jpegData(compressionQuality: 0.75)
        }
    }

    private func loadImages() async -> [Data] {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
            .filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
            .prefix(Self.maxImages)
        var out: [Data] = []
        for provider in providers {
            if let jpeg = await loadJPEG(from: provider) { out.append(jpeg) }
        }
        return out
    }

    // The screenshot editor hands over a UIImage; Photos hands over a file URL
    // or raw data. Downscale without decoding the full image (share extensions
    // run under a tight memory limit).
    private func loadJPEG(from provider: NSItemProvider) async -> Data? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, _ in
                var image: CGImage?
                if let url = item as? URL, let source = CGImageSourceCreateWithURL(url as CFURL, nil) {
                    image = ShareImage.thumbnail(source)
                } else if let data = item as? Data, let source = CGImageSourceCreateWithData(data as CFData, nil) {
                    image = ShareImage.thumbnail(source)
                } else if let ui = item as? UIImage {
                    image = ShareImage.scaled(ui)
                }
                let jpeg = image.flatMap { UIImage(cgImage: $0).jpegData(compressionQuality: 0.75) }
                continuation.resume(returning: jpeg)
            }
        }
    }

    // MARK: - UI

    private func buildUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.35)

        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0
        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textColor = .secondaryLabel
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0
        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        doneButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        doneButton.isHidden = true

        let stack = UIStackView(arrangedSubviews: [spinner, titleLabel, detailLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 10
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 280),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18)
        ])
    }

    private func show(title: String, detail: String, busy: Bool) {
        titleLabel.text = title
        detailLabel.text = detail
        if busy { spinner.startAnimating() } else { spinner.stopAnimating() }
        spinner.isHidden = !busy
    }

    private func finish(title: String, detail: String, autoClose: Bool) {
        DispatchQueue.main.async {
            guard !self.finished else { return }
            self.show(title: title, detail: detail, busy: false)
            self.doneButton.isHidden = false
            if autoClose {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { self.close() }
            }
        }
    }

    @objc private func close() {
        guard !finished else { return }
        finished = true
        extensionContext?.completeRequest(returningItems: nil)
    }
}

// Downscaling, off the main actor (runs in NSItemProvider's callback).
enum ShareImage {
    // Claude reads images at up to ~1568px on the long edge; anything larger is
    // downscaled server-side anyway, so don't upload it.
    static let maxPixelSize: CGFloat = 1568

    static func thumbnail(_ source: CGImageSource) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    static func scaled(_ image: UIImage) -> CGImage? {
        let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let longEdge = max(px.width, px.height)
        guard longEdge > 0 else { return nil }
        let factor = min(1, maxPixelSize / longEdge)
        let target = CGSize(width: floor(px.width * factor), height: floor(px.height * factor))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }.cgImage
    }
}

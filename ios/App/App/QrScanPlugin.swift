import Foundation
import Capacitor
import AVFoundation
import UIKit

// A full-screen camera that reads one QR code, exposed as the "QrScan" plugin
// (native-bridge.js → nativeQrScan()). Used by messaging to link a browser and to
// verify a contact's security code (MESSAGING_DESIGN.md §3, decision 9). AVFoundation,
// so it works on the app's iOS 15 target.
//   • scan({ prompt?, barcodes? }) → { text, format } on success; rejects "CANCELLED"
//     if the person closes it, "DENIED" without camera permission, "UNAVAILABLE"
//     with no camera. With `barcodes: true` it also reads card barcodes (Code 128,
//     EAN, UPC, Code 39, PDF417, Aztec, Data Matrix) for Wallet.
@objc(QrScanPlugin)
public class QrScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QrScanPlugin"
    public let jsName = "QrScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    @objc func scan(_ call: CAPPluginCall) {
        let prompt = call.getString("prompt") ?? "Point the camera at the code"
        let barcodes = call.getBool("barcodes") ?? false
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            present(call, prompt: prompt, barcodes: barcodes)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.present(call, prompt: prompt, barcodes: barcodes) } else { call.reject("Camera access was declined", "DENIED") }
                }
            }
        default:
            call.reject("Camera access is off for this app in Settings", "DENIED")
        }
    }

    private func present(_ call: CAPPluginCall, prompt: String, barcodes: Bool = false) {
        DispatchQueue.main.async {
            guard AVCaptureDevice.default(for: .video) != nil else {
                call.reject("No camera on this device", "UNAVAILABLE")
                return
            }
            if let old = self.pending { old.reject("Replaced by a new scan", "CANCELLED") }
            self.pending = call
            let vc = QrScanViewController()
            vc.prompt = prompt
            vc.barcodes = barcodes
            vc.modalPresentationStyle = .fullScreen
            vc.onFinish = { [weak self] text, format in
                guard let self = self, let c = self.pending else { return }
                self.pending = nil
                if let text = text { c.resolve(["text": text, "format": format ?? "qr"]) } else { c.reject("Closed without scanning", "CANCELLED") }
            }
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }
}

final class QrScanViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var prompt = ""
    var barcodes = false
    var onFinish: ((String?, String?) -> Void)?
    private let session = AVCaptureSession()
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            finish(nil)
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { finish(nil); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = barcodes
            ? [.qr, .code128, .ean13, .ean8, .upce, .code39, .code93, .pdf417, .aztec, .dataMatrix, .interleaved2of5].filter { output.availableMetadataObjectTypes.contains($0) }
            : [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)

        let label = UILabel()
        label.text = prompt
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .headline)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)

        let close = UIButton(type: .system)
        close.setTitle("Cancel", for: .normal)
        close.setTitleColor(.white, for: .normal)
        close.titleLabel?.font = .preferredFont(forTextStyle: .body)
        close.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            close.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            close.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24)
        ])

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.session.startRunning() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.compactMap { $0 as? AVCaptureVideoPreviewLayer }.forEach { $0.frame = view.bounds }
    }

    @objc private func cancelTapped() { finish(nil) }

    static func formatName(_ type: AVMetadataObject.ObjectType) -> String {
        switch type {
        case .qr: return "qr"
        case .code128: return "code128"
        case .ean13: return "ean13"
        case .ean8: return "ean8"
        case .upce: return "upce"
        case .code39: return "code39"
        case .code93: return "code93"
        case .pdf417: return "pdf417"
        case .aztec: return "aztec"
        case .dataMatrix: return "datamatrix"
        case .interleaved2of5: return "itf"
        default: return "other"
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
              barcodes || code.type == .qr, let text = code.stringValue, !text.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(text, format: QrScanViewController.formatName(code.type))
    }

    private func finish(_ text: String?, format: String? = nil) {
        guard !finished else { return }
        finished = true
        if session.isRunning { session.stopRunning() }
        let done = onFinish
        DispatchQueue.main.async {
            if self.presentingViewController != nil {
                self.dismiss(animated: true) { done?(text, format) }
            } else {
                done?(text, format)
            }
        }
    }
}

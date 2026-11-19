import Foundation
import Capacitor
import AVFoundation
import UIKit

// A full-screen camera that reads one QR code, exposed as the "QrScan" plugin
// (native-bridge.js → nativeQrScan()). Used by messaging to link a browser and to
// verify a contact's security code (MESSAGING_DESIGN.md §3, decision 9). AVFoundation,
// so it works on the app's iOS 15 target.
//   • scan({ prompt? }) → { text } on success; rejects "CANCELLED" if the person
//     closes it, "DENIED" without camera permission, "UNAVAILABLE" with no camera.
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
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            present(call, prompt: prompt)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.present(call, prompt: prompt) } else { call.reject("Camera access was declined", "DENIED") }
                }
            }
        default:
            call.reject("Camera access is off for this app in Settings", "DENIED")
        }
    }

    private func present(_ call: CAPPluginCall, prompt: String) {
        DispatchQueue.main.async {
            guard AVCaptureDevice.default(for: .video) != nil else {
                call.reject("No camera on this device", "UNAVAILABLE")
                return
            }
            if let old = self.pending { old.reject("Replaced by a new scan", "CANCELLED") }
            self.pending = call
            let vc = QrScanViewController()
            vc.prompt = prompt
            vc.modalPresentationStyle = .fullScreen
            vc.onFinish = { [weak self] text in
                guard let self = self, let c = self.pending else { return }
                self.pending = nil
                if let text = text { c.resolve(["text": text]) } else { c.reject("Closed without scanning", "CANCELLED") }
            }
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }
}

final class QrScanViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var prompt = ""
    var onFinish: ((String?) -> Void)?
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
        output.metadataObjectTypes = [.qr]

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

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
              code.type == .qr, let text = code.stringValue, !text.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(text)
    }

    private func finish(_ text: String?) {
        guard !finished else { return }
        finished = true
        if session.isRunning { session.stopRunning() }
        let done = onFinish
        DispatchQueue.main.async {
            if self.presentingViewController != nil {
                self.dismiss(animated: true) { done?(text) }
            } else {
                done?(text)
            }
        }
    }
}

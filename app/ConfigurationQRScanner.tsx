"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Link, X } from "lucide-react";
import jsQR from "jsqr";

interface ConfigurationQRScannerProps {
  onClose: () => void;
  onScan: (value: string) => void;
}

function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext) return "Camera scanning requires HTTPS. Open Gate Control using its secure address, or choose a QR image from Photos below.";
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Camera access was denied. Allow camera access for Gate Control in iPhone Settings, then try again.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No camera was found on this device.";
  return "The camera could not be opened. You can choose a QR image from Photos or paste the shared link instead.";
}

export function ConfigurationQRScanner({ onClose, onScan }: ConfigurationQRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const [message, setMessage] = useState("Point the camera at a Gate Control configuration QR code.");
  const [manualLink, setManualLink] = useState("");

  const stopCamera = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const finish = (value: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopCamera();
    onScan(value);
  };

  useEffect(() => {
    let disposed = false;
    const scanFrame = () => {
      if (disposed || finishedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        const width = Math.min(video.videoWidth, 960);
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, width, height);
          const image = context.getImageData(0, 0, width, height);
          const result = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
          if (result?.data) { finish(result.data); return; }
        }
      }
      animationRef.current = requestAnimationFrame(scanFrame);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage(cameraErrorMessage(new Error("Camera API unavailable")));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          animationRef.current = requestAnimationFrame(scanFrame);
        }
      } catch (error) { if (!disposed) setMessage(cameraErrorMessage(error)); }
    };
    void start();
    return () => { disposed = true; stopCamera(); };
  }, []);

  const scanImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Scanner unavailable");
      const width = Math.min(bitmap.width, 1600);
      const height = Math.round(width * bitmap.height / bitmap.width);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Scanner unavailable");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const image = context.getImageData(0, 0, width, height);
      const result = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
      if (!result?.data) throw new Error("No QR code was found in that image.");
      finish(result.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "That image could not be scanned."); }
    finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  return <div className="qr-scanner-backdrop" role="presentation">
    <section className="qr-scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="configuration-scanner-title">
      <header><div><p className="eyebrow">Configuration transfer</p><h2 id="configuration-scanner-title">Scan QR code</h2></div><button type="button" className="icon-button" aria-label="Close scanner" onClick={() => { stopCamera(); onClose(); }}><X /></button></header>
      <div className="qr-camera-view"><video ref={videoRef} muted playsInline aria-label="Camera preview" /><span className="qr-camera-frame" aria-hidden="true" /><Camera aria-hidden="true" /></div>
      <canvas ref={canvasRef} hidden />
      <p className="qr-scanner-message" role="status">{message}</p>
      <div className="qr-image-actions">
        <button type="button" className="secondary-button" onClick={() => cameraInputRef.current?.click()}><Camera /> Take QR photo</button>
        <button type="button" className="secondary-button" onClick={() => imageInputRef.current?.click()}><ImageIcon /> Choose from Photos</button>
      </div>
      <input ref={cameraInputRef} className="transfer-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => void scanImage(event.target.files?.[0])} />
      <input ref={imageInputRef} className="transfer-file-input" type="file" accept="image/*" onChange={(event) => void scanImage(event.target.files?.[0])} />
      <div className="qr-manual-link"><label><span>Or paste the shared link</span><input type="url" inputMode="url" placeholder="https://…?gateTransfer=…" value={manualLink} onChange={(event) => setManualLink(event.target.value)} /></label><button type="button" className="secondary-button" disabled={!manualLink.trim()} onClick={() => finish(manualLink.trim())}><Link /> Use link</button></div>
    </section>
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Link, LoaderCircle, X } from "lucide-react";
import jsQR from "jsqr";

interface ConfigurationQRScannerProps {
  onClose: () => void;
  onScan: (value: string) => void;
}

function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext) return "Live camera scanning requires HTTPS. On this LAN connection, use Take QR photo below.";
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
  const [mode, setMode] = useState<"starting" | "live" | "processing" | "unavailable">("starting");
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
      if (!window.isSecureContext) {
        setMode("unavailable");
        setMessage(cameraErrorMessage(new Error("Secure connection required")));
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setMode("unavailable");
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
          setMode("live");
          animationRef.current = requestAnimationFrame(scanFrame);
        }
      } catch (error) {
        if (!disposed) {
          setMode("unavailable");
          setMessage(cameraErrorMessage(error));
        }
      }
    };
    void start();
    return () => { disposed = true; stopCamera(); };
  }, []);

  const scanImage = async (file: File | undefined) => {
    if (!file) return;
    stopCamera();
    setMode("processing");
    setMessage("Scanning the selected photo for a Gate Control QR code…");
    let objectUrl = "";
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Scanner unavailable");
      objectUrl = URL.createObjectURL(file);
      const selectedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("The iPhone photo could not be opened. Try choosing a screenshot of the QR code instead."));
        image.src = objectUrl;
      });
      const largestSide = Math.max(selectedImage.naturalWidth, selectedImage.naturalHeight);
      const scale = Math.min(1, 2048 / largestSide);
      const width = Math.max(1, Math.round(selectedImage.naturalWidth * scale));
      const height = Math.max(1, Math.round(selectedImage.naturalHeight * scale));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Scanner unavailable");
      context.drawImage(selectedImage, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      const result = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
      if (!result?.data) throw new Error("No QR code was found. Retake the photo closer, with the entire square QR code visible and in focus.");
      finish(result.data);
    } catch (error) {
      setMode("unavailable");
      setMessage(error instanceof Error ? error.message : "That image could not be scanned.");
    }
    finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  return <div className="qr-scanner-backdrop" role="presentation">
    <section className="qr-scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="configuration-scanner-title">
      <header><div><p className="eyebrow">Configuration transfer</p><h2 id="configuration-scanner-title">Scan QR code</h2></div><button type="button" className="icon-button" aria-label="Close scanner" onClick={() => { stopCamera(); onClose(); }}><X /></button></header>
      <div className={`qr-camera-view qr-camera-view--${mode}`}>
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {mode === "live" ? <span className="qr-camera-frame" aria-hidden="true" /> : <div className="qr-camera-state" aria-hidden="true">{mode === "processing" ? <LoaderCircle className="spin" /> : <Camera />}<strong>{mode === "starting" ? "Opening camera…" : mode === "processing" ? "Scanning photo…" : "Live scanner unavailable"}</strong>{mode === "unavailable" && <span>Use Take QR photo below</span>}</div>}
      </div>
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

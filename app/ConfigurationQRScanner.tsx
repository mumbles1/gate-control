"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Link, LoaderCircle, ScanLine, X } from "lucide-react";
import jsQR from "jsqr";

interface ConfigurationQRScannerProps {
  onClose: () => void;
  onScan: (value: string) => void;
}

interface DetectedBarcode {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

function cameraErrorMessage(error: unknown) {
  if (!window.isSecureContext) return "Live camera scanning requires HTTPS. On this LAN connection, use Take QR photo below.";
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Camera access was denied. Allow camera access for Gate Control in iPhone Settings, then try again.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No camera was found on this device.";
  return "The camera could not be opened. You can choose a QR image from Photos or paste the shared link instead.";
}

function loadPhoto(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const timeout = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The photo took too long to open. Try a screenshot of the QR code instead."));
    }, 15000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve({ image, objectUrl });
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      reject(new Error("That photo format could not be opened. Take a screenshot of the QR code and choose the screenshot instead."));
    };
    image.src = objectUrl;
  });
}

async function detectNativeQRCode(canvas: HTMLCanvasElement): Promise<string | null> {
  const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const results = await new Detector({ formats: ["qr_code"] }).detect(canvas);
    return results.find((result) => result.rawValue)?.rawValue ?? null;
  } catch {
    return null;
  }
}

async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const nativeResult = await detectNativeQRCode(canvas);
  if (nativeResult) return nativeResult;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

async function decodePhoto(image: HTMLImageElement, canvas: HTMLCanvasElement): Promise<string | null> {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight) return null;

  // iPhone photos can be large and carry an orientation flag. Drawing the decoded
  // HTML image applies that orientation; several sizes and rotations make angled
  // camera photos substantially easier for QR detectors to read.
  const targetSizes = [2400, 1600, 1000];
  const rotations = [0, 90, 270, 180];
  for (const targetSize of targetSizes) {
    const scale = Math.min(1, targetSize / Math.max(naturalWidth, naturalHeight));
    const sourceWidth = Math.max(1, Math.round(naturalWidth * scale));
    const sourceHeight = Math.max(1, Math.round(naturalHeight * scale));
    for (const rotation of rotations) {
      const sideways = rotation === 90 || rotation === 270;
      canvas.width = sideways ? sourceHeight : sourceWidth;
      canvas.height = sideways ? sourceWidth : sourceHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
      context.restore();
      const result = await decodeCanvas(canvas);
      if (result) return result;
    }
  }
  return null;
}

export function ConfigurationQRScanner({ onClose, onScan }: ConfigurationQRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const [mode, setMode] = useState<"starting" | "live" | "processing" | "unavailable" | "error">("starting");
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
    const scanFrame = async () => {
      if (disposed || finishedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        const width = Math.min(video.videoWidth, 1280);
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, width, height);
          const result = await decodeCanvas(canvas);
          if (result) { finish(result); return; }
        }
      }
      animationRef.current = requestAnimationFrame(() => void scanFrame());
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
          animationRef.current = requestAnimationFrame(() => void scanFrame());
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
      if (!canvas) throw new Error("The scanner is unavailable. Close this window and try again.");
      const loaded = await loadPhoto(file);
      objectUrl = loaded.objectUrl;
      const result = await decodePhoto(loaded.image, canvas);
      if (!result) throw new Error("No QR code was found. Retake the photo closer, with the complete square code visible and in focus.");
      finish(result);
    } catch (error) {
      setMode("error");
      setMessage(error instanceof Error ? error.message : "That image could not be scanned. Try another photo.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const stateTitle = mode === "starting"
    ? "Opening camera…"
    : mode === "processing"
      ? "Scanning photo…"
      : mode === "error"
        ? "QR code not read"
        : "Live scanner unavailable";

  return <div className="qr-scanner-backdrop" role="presentation">
    <section className="qr-scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="configuration-scanner-title">
      <header><div><p className="eyebrow">Configuration transfer</p><h2 id="configuration-scanner-title">Scan QR code</h2></div><button type="button" className="icon-button" aria-label="Close scanner" onClick={() => { stopCamera(); onClose(); }}><X /></button></header>
      <div className={`qr-camera-view qr-camera-view--${mode}`}>
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {mode === "live" ? <span className="qr-camera-frame" aria-hidden="true" /> : <div className="qr-camera-state" aria-hidden="true">{mode === "processing" ? <LoaderCircle className="spin" /> : mode === "error" ? <ScanLine /> : <Camera />}<strong>{stateTitle}</strong>{(mode === "unavailable" || mode === "error") && <span>Take another photo or choose a QR image from Photos</span>}</div>}
      </div>
      <canvas ref={canvasRef} hidden />
      <p className={`qr-scanner-message${mode === "error" ? " qr-scanner-message--error" : ""}`} role="status">{message}</p>
      <div className="qr-image-actions">
        <button type="button" className="secondary-button" disabled={mode === "processing"} onClick={() => cameraInputRef.current?.click()}><Camera /> Take QR photo</button>
        <button type="button" className="secondary-button" disabled={mode === "processing"} onClick={() => imageInputRef.current?.click()}><ImageIcon /> Choose from Photos</button>
      </div>
      <input ref={cameraInputRef} className="transfer-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => void scanImage(event.currentTarget.files?.[0])} />
      <input ref={imageInputRef} className="transfer-file-input" type="file" accept="image/*" onChange={(event) => void scanImage(event.currentTarget.files?.[0])} />
      <div className="qr-manual-link"><label><span>Or paste the shared link</span><input type="url" inputMode="url" placeholder="https://…?gateTransfer=…" value={manualLink} onChange={(event) => setManualLink(event.target.value)} /></label><button type="button" className="secondary-button" disabled={!manualLink.trim()} onClick={() => finish(manualLink.trim())}><Link /> Use link</button></div>
    </section>
  </div>;
}

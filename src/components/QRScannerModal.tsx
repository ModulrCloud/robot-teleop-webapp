import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faQrcode, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import jsQR from 'jsqr';
import './QRScannerModal.css';

export interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

export function QRScannerModal({ isOpen, onClose, onScan }: QRScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setCameraError(null);
      stopStream();
      return;
    }

    let cancelled = false;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const startCamera = async () => {
      setCameraError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Camera access failed';
        setCameraError(
          message.includes('Permission') || message.includes('NotAllowed')
            ? 'Camera access denied. Allow camera in your browser to scan QR codes.'
            : 'Could not access camera. Try again or paste the key manually.'
        );
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isOpen, stopStream]);

  useEffect(() => {
    if (!isOpen || !videoRef.current || !canvasRef.current || cameraError) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    // willReadFrequently: true avoids console warning and improves getImageData performance in the loop
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    function tick() {
      if (streamRef.current == null || !video.videoWidth) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        stopStream();
        onScan(code.data);
        onClose();
        return;
      }
      animationRef.current = requestAnimationFrame(tick);
    }

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isOpen, cameraError, onScan, onClose, stopStream]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="qr-scanner-overlay" onClick={onClose}>
      <div className="qr-scanner-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-scanner-header">
          <div className="qr-scanner-header-left">
            <FontAwesomeIcon icon={faQrcode} className="qr-scanner-icon" />
            <div>
              <h2>Scan QR code</h2>
              <p className="qr-scanner-subtitle">Point your camera at the robot&apos;s public key QR code</p>
            </div>
          </div>
          <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        <div className="qr-scanner-video-wrap">
          {cameraError ? (
            <div className="qr-scanner-error">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <p>{cameraError}</p>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="qr-scanner-video" playsInline muted />
              <canvas ref={canvasRef} className="qr-scanner-canvas" aria-hidden />
            </>
          )}
        </div>
        <div className="qr-scanner-footer">
          <button type="button" className="qr-scanner-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

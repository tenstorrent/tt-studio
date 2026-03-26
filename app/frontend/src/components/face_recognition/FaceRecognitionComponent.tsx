// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useLocation, useNavigate } from "react-router-dom";
import { customToast } from "../CustomToaster";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Camera,
  CameraOff,
  UserPlus,
  Trash2,
  Users,
  RefreshCw,
  Upload,
  ArrowRight,
  Mic,
  X,
} from "lucide-react";
import axios from "axios";

const RECOGNITION_THRESHOLD = 0.65;
const REDIRECT_DELAY_SECONDS = 5;

interface Detection {
  box?: number[];
  bbox?: number[];
  identity: string;
  similarity: number;
  confidence?: number;
}

export default function FaceRecognitionComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const modelID = (location.state?.containerID || location.state?.modelID) as string | undefined;
  // Camera & recognition state
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  // Registration state
  const [registeredFaces, setRegisteredFaces] = useState<string[]>([]);
  const [newFaceName, setNewFaceName] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Verified face & auto-redirect state
  const [verifiedUser, setVerifiedUser] = useState<{ name: string; similarity: number } | null>(null);
  const [verifiedSnapshot, setVerifiedSnapshot] = useState<string | null>(null);
  const [autoRedirectCountdown, setAutoRedirectCountdown] = useState<number | null>(null);
  const verifiedUserRef = useRef<{ name: string; similarity: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isLiveRef = useRef(false);
  const processingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Fetch registered faces
  const fetchRegisteredFaces = useCallback(async () => {
    if (!modelID) return;
    try {
      const response = await axios.get(`/models-api/face-recognition/faces/?deploy_id=${modelID}`);
      setRegisteredFaces(response.data.faces || []);
    } catch (error) {
      console.error("Failed to fetch registered faces:", error);
    }
  }, [modelID]);
  useEffect(() => {
    fetchRegisteredFaces();
  }, [fetchRegisteredFaces]);
  // Start camera and recognition
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraOn(true);
        // Start recognition after a short delay
        setTimeout(() => {
          isLiveRef.current = true;
          setIsLiveMode(true);
        }, 500);
      }
    } catch (error) {
      customToast.error("Failed to access camera");
      console.error(error);
    }
  }, []);
  // Stop camera
  const stopCamera = useCallback(() => {
    isLiveRef.current = false;
    setIsLiveMode(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraOn(false);
    setDetections([]);
  }, []);
  // Auto-start camera on mount (with delay to ensure DOM is ready)
  useEffect(() => {
    if (modelID) {
      const timer = setTimeout(() => {
        startCamera();
      }, 500);
      return () => {
        clearTimeout(timer);
        stopCamera();
      };
    }
  }, [modelID, startCamera, stopCamera]);
  // Dismiss the verified-user overlay and cancel auto-redirect
  const dismissVerification = useCallback(() => {
    verifiedUserRef.current = null;
    setVerifiedUser(null);
    setVerifiedSnapshot(null);
    setAutoRedirectCountdown(null);
  }, []);

  // Navigate immediately to voice agent
  const goToVoiceAgent = useCallback((user: { name: string; similarity: number }) => {
    navigate("/voice-agent", {
      state: { recognizedUser: user.name, recognizedSimilarity: user.similarity },
    });
  }, [navigate]);

  // Run recognition
  const runRecognition = useCallback(async (imageBlob: Blob) => {
    if (!modelID) return;
    const formData = new FormData();
    formData.append("deploy_id", modelID);
    formData.append("image", imageBlob, "frame.jpg");
    try {
      const response = await axios.post("/models-api/face-recognition/recognize/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const faces: Detection[] = response.data.faces || [];
      setDetections(faces);
      setInferenceMs(response.data.inference_ms);
      // Trigger verified-user flow on first high-confidence known face
      if (!verifiedUserRef.current) {
        const verified = faces.find(
          (d) => d.identity && d.identity !== "Unknown" && d.similarity >= RECOGNITION_THRESHOLD
        );
        if (verified) {
          const user = { name: verified.identity, similarity: verified.similarity };
          verifiedUserRef.current = user;
          // Capture face snapshot from current video frame
          if (videoRef.current && canvasRef.current) {
            const snapCanvas = canvasRef.current;
            const video = videoRef.current;
            snapCanvas.width = video.videoWidth;
            snapCanvas.height = video.videoHeight;
            const ctx = snapCanvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0);
              setVerifiedSnapshot(snapCanvas.toDataURL("image/jpeg", 0.85));
            }
          }
          setVerifiedUser(user);
        }
      }
    } catch (error) {
      console.error("Recognition failed:", error);
    }
  }, [modelID]);
  // Recognition loop
  const processFrame = useCallback(async () => {
    if (!isLiveRef.current || processingRef.current || !videoRef.current) return;
    processingRef.current = true;
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8);
      });
      if (blob) {
        await runRecognition(blob);
      }
    } catch (error) {
      console.error("Error processing frame:", error);
    } finally {
      processingRef.current = false;
      if (isLiveRef.current) {
        requestAnimationFrame(processFrame);
      }
    }
  }, [runRecognition]);
  // Start processing when live mode enabled
  useEffect(() => {
    if (isLiveMode && isCameraOn) {
      processFrame();
    }
  }, [isLiveMode, isCameraOn, processFrame]);

  // Start countdown when a verified user is detected
  useEffect(() => {
    if (!verifiedUser) return;
    setAutoRedirectCountdown(REDIRECT_DELAY_SECONDS);
    const interval = setInterval(() => {
      setAutoRedirectCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [verifiedUser]);

  // Auto-navigate when countdown reaches zero
  useEffect(() => {
    if (autoRedirectCountdown === 0 && verifiedUser) {
      goToVoiceAgent(verifiedUser);
    }
  }, [autoRedirectCountdown, verifiedUser, goToVoiceAgent]);
  // Register face from file
  const registerFace = async () => {
    if (!modelID || !newFaceName.trim() || !selectedFile) {
      customToast.error("Please enter a name and select an image");
      return;
    }
    setIsRegistering(true);
    try {
      const formData = new FormData();
      formData.append("deploy_id", modelID);
      formData.append("name", newFaceName.trim());
      formData.append("image", selectedFile);
      await axios.post("/models-api/face-recognition/register/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      customToast.success(`Registered: ${newFaceName}`);
      setNewFaceName("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchRegisteredFaces();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      customToast.error(err.response?.data?.error || "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  };
  // Register face from current frame
  const registerFromCamera = async () => {
    if (!modelID || !newFaceName.trim() || !videoRef.current || !canvasRef.current) {
      customToast.error("Please enter a name first");
      return;
    }
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;

      setIsRegistering(true);
      try {
        const formData = new FormData();
        formData.append("deploy_id", modelID);
        formData.append("name", newFaceName.trim());
        formData.append("image", blob, "capture.jpg");
        await axios.post("/models-api/face-recognition/register/", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        customToast.success(`Registered: ${newFaceName}`);
        setNewFaceName("");
        fetchRegisteredFaces();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { error?: string } } };
        customToast.error(err.response?.data?.error || "Registration failed");
      } finally {
        setIsRegistering(false);
      }
    }, "image/jpeg", 0.9);
  };
  // Delete face
  const deleteFace = async (name: string) => {
    if (!modelID) return;
    try {
      await axios.delete(`/models-api/face-recognition/faces/${name}/?deploy_id=${modelID}`);
      customToast.success(`Deleted: ${name}`);
      fetchRegisteredFaces();
    } catch (error) {
      customToast.error("Failed to delete face");
    }
  };
  // Render detection boxes — tactical targeting brackets
  const renderDetectionBoxes = () => {
    if (!videoRef.current || !Array.isArray(detections) || detections.length === 0) return null;

    const video = videoRef.current;
    const scaleX = video.clientWidth / (video.videoWidth || 1);
    const scaleY = video.clientHeight / (video.videoHeight || 1);
    return detections.map((det, idx) => {
      const box = det.box || det.bbox;
      if (!det || !box || !Array.isArray(box) || box.length < 4) {
        return null;
      }

      const [x1, y1, x2, y2] = box;
      const isKnown = det.identity && det.identity !== "Unknown";
      const similarity = typeof det.similarity === "number" ? det.similarity : 0;
      const color = isKnown ? "#7C68FA" : "#FA512E";
      const bracketSize = 14;
      const bw = isKnown ? 2 : 3;

      return (
        <div
          key={idx}
          className="absolute pointer-events-none"
          style={{
            left: x1 * scaleX,
            top: y1 * scaleY,
            width: (x2 - x1) * scaleX,
            height: (y2 - y1) * scaleY,
          }}
        >
          {/* Corner brackets */}
          <div style={{ position: "absolute", top: 0, left: 0, width: bracketSize, height: bracketSize, borderTop: `${bw}px solid ${color}`, borderLeft: `${bw}px solid ${color}` }} />
          <div style={{ position: "absolute", top: 0, right: 0, width: bracketSize, height: bracketSize, borderTop: `${bw}px solid ${color}`, borderRight: `${bw}px solid ${color}` }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: bracketSize, height: bracketSize, borderBottom: `${bw}px solid ${color}`, borderLeft: `${bw}px solid ${color}` }} />
          <div style={{ position: "absolute", bottom: 0, right: 0, width: bracketSize, height: bracketSize, borderBottom: `${bw}px solid ${color}`, borderRight: `${bw}px solid ${color}` }} />
          {/* Thin dashed tracking border */}
          <div style={{ position: "absolute", inset: 0, border: `1px dashed ${color}${isKnown ? "33" : "66"}` }} />
          {/* Data readout label */}
          {isKnown ? (
            <div
              className="absolute -top-6 left-0 flex items-center gap-1.5 whitespace-nowrap font-mono"
              style={{ color, fontSize: "10px" }}
            >
              <div className="w-1.5 h-1.5 rounded-full hud-blink" style={{ backgroundColor: color }} />
              <span className="uppercase tracking-wider">{det.identity}</span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span>{(similarity * 100).toFixed(1)}%</span>
            </div>
          ) : (
            <div
              className="absolute -top-7 left-0 flex items-center gap-1.5 whitespace-nowrap font-mono"
              style={{ fontSize: "11px" }}
            >
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded"
                style={{ backgroundColor: "rgba(250, 81, 46, 0.85)", color: "#fff" }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white hud-blink" />
                <span className="uppercase tracking-wider font-bold">Unidentified</span>
                <span style={{ opacity: 0.6 }}>|</span>
                <span>{(similarity * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>
      );
    });
  };
  // No model deployed message
  if (!modelID) {
    return (
      <div className="max-w-2xl w-full flex flex-col items-center justify-center h-full voice-glass voice-tile-3d rounded-2xl p-8">
        <h2 className="font-mono text-TT-purple-accent text-lg uppercase tracking-widest mb-2">System Offline</h2>
        <p className="font-mono text-TT-purple-accent/50 text-xs uppercase tracking-wider">
          Deploy Face Recognition model to initialize
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-2xl w-full flex flex-col rounded-2xl overflow-hidden h-full voice-glass voice-tile-3d">
      {/* Header — matches Voice Agent */}
      <header className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold font-['Bricolage_Grotesque'] tracking-tight" style={{ color: "#e4e4e7" }}>
            Face Recognition
          </h1>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isLiveMode ? "bg-TT-purple-accent hud-blink" : "bg-gray-500"}`} />
            <span className="text-xs font-mono font-medium tracking-wide text-TT-purple-accent">
              {isLiveMode ? "Scanning" : "Ready"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {inferenceMs && isLiveMode && (
            <span className="font-mono text-xs text-TT-purple/60">
              {(1000 / inferenceMs).toFixed(1)} fps
            </span>
          )}
          <Button
            onClick={() => navigate("/voice-agent")}
            variant="ghost"
            size="sm"
            className="text-xs text-white/50 hover:text-white/80 hover:bg-white/5"
          >
            Skip <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
          {isCameraOn ? (
            <Button onClick={stopCamera} size="sm" className="text-xs bg-TT-red-accent/20 text-TT-red-accent border border-TT-red-accent/30 hover:bg-TT-red-accent/30">
              <CameraOff className="w-3 h-3 mr-1" /> Stop
            </Button>
          ) : (
            <Button onClick={startCamera} size="sm" className="text-xs bg-TT-purple-accent/20 text-TT-purple-accent border border-TT-purple-accent/30 hover:bg-TT-purple-accent/30">
              <Camera className="w-3 h-3 mr-1" /> Start
            </Button>
          )}
        </div>
      </header>

      {/* Video Feed */}
      <div className="flex-1 min-h-0 relative bg-black overflow-hidden">
        {/* Corner bracket reticles */}
        <div className="hud-corner hud-corner--tl" />
        <div className="hud-corner hud-corner--tr" />
        <div className="hud-corner hud-corner--bl" />
        <div className="hud-corner hud-corner--br" />
        {/* Animated scan line */}
        {isLiveMode && isCameraOn && <div className="hud-scanline" />}
        {/* CRT scan lines overlay */}
        {isCameraOn && <div className="hud-crt-lines" />}
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
        {isLiveMode && isCameraOn && renderDetectionBoxes()}
        <canvas ref={canvasRef} className="hidden" />
        {!isCameraOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-full border-2 border-TT-purple-accent/30 flex items-center justify-center">
              <Camera className="w-7 h-7 text-TT-purple-accent/50" />
            </div>
            <p className="font-mono text-xs text-white/30 uppercase tracking-widest">Feed Offline</p>
            <Button onClick={startCamera} className="font-mono text-xs bg-TT-purple-accent/20 text-TT-purple-accent border border-TT-purple-accent/30 hover:bg-TT-purple-accent/30 uppercase tracking-wider">
              <Camera className="w-4 h-4 mr-2" /> Initialize Feed
            </Button>
          </div>
        )}
        {/* "Look at camera" instruction */}
        {isCameraOn && isLiveMode && detections.length === 0 && !verifiedUser && (
          <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-2 bg-black/70 backdrop-blur-sm py-3 px-4 pointer-events-none border-t border-TT-purple-accent/20">
            <div className="w-2 h-2 rounded-full bg-TT-purple-accent hud-blink" />
            <span className="font-mono text-TT-purple-accent text-xs uppercase tracking-widest">
              Awaiting subject // Position face in frame
            </span>
          </div>
        )}
        {/* Verified face overlay */}
        {verifiedUser && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10 hud-confirm-enter">
            <div className="voice-glass rounded-lg p-6 mx-6 text-center max-w-xs w-full border border-TT-purple-accent/30"
              style={{ boxShadow: "0 0 40px rgba(124, 104, 250, 0.15), 0 0 80px rgba(124, 104, 250, 0.08)" }}>
              <div className="font-mono text-TT-purple-accent/50 uppercase mb-3" style={{ fontSize: "10px", letterSpacing: "0.3em" }}>
                // Classified // Biometric Verification
              </div>
              <div className="w-20 h-20 rounded-full border-2 border-TT-purple-accent mx-auto mb-3 overflow-hidden"
                style={{ boxShadow: "0 0 20px rgba(124, 104, 250, 0.3)" }}>
                {verifiedSnapshot ? (
                  <img src={verifiedSnapshot} alt="Captured face" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-black/40">
                    <span className="text-3xl font-mono font-bold text-TT-purple-accent">
                      {verifiedUser.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <h3 className="font-mono text-TT-purple-accent text-base uppercase tracking-widest mb-1">
                Identity Confirmed
              </h3>
              <p className="font-mono text-TT-purple-tint1 text-sm mb-1">{verifiedUser.name}</p>
              <p className="font-mono text-TT-purple-accent/60 text-xs mb-1">
                Match Confidence: {(verifiedUser.similarity * 100).toFixed(1)}%
              </p>
              <p className="font-mono text-white/30 text-xs mb-4">
                Redirecting in <span className="text-TT-purple-accent font-bold">{autoRedirectCountdown}s</span>
              </p>
              <div className="w-full rounded-full h-1 mb-5" style={{ backgroundColor: "rgba(124, 104, 250, 0.15)" }}>
                <div className="bg-TT-purple-accent h-1 rounded-full transition-all duration-1000"
                  style={{
                    width: `${autoRedirectCountdown !== null ? ((autoRedirectCountdown / REDIRECT_DELAY_SECONDS) * 100) : 100}%`,
                    boxShadow: "0 0 8px rgba(124, 104, 250, 0.5)",
                  }}
                />
              </div>
              <div className="flex gap-3">
                <Button onClick={() => goToVoiceAgent(verifiedUser)}
                  className="flex-1 text-xs bg-TT-purple-accent/20 text-TT-purple-accent border border-TT-purple-accent/40 hover:bg-TT-purple-accent/30">
                  <Mic className="w-4 h-4 mr-2" /> Proceed <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button onClick={dismissVerification}
                  className="flex-1 text-xs bg-transparent text-white/40 border border-white/10 hover:bg-white/5 hover:text-white/60">
                  <X className="w-4 h-4 mr-2" /> Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Panel — Detection results + Registration */}
      <div className="shrink-0 border-t border-white/[0.06] px-4 py-3 space-y-3 overflow-y-auto" style={{ maxHeight: "220px" }}>
        {/* Detection Results */}
        <div className="font-mono">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${detections.length > 0 ? "bg-TT-purple-accent hud-blink" : "bg-gray-600"}`} />
            <span className="text-xs text-white/40 uppercase tracking-widest">
              {!Array.isArray(detections) || detections.length === 0
                ? "No Subjects Detected"
                : `${detections.length} Subject${detections.length !== 1 ? "s" : ""} Identified`}
            </span>
          </div>
          {Array.isArray(detections) && detections.length > 0 && (
            <div className="space-y-1">
              {detections.map((det, idx) => {
                if (!det) return null;
                const identity = det.identity || "Unknown";
                const similarity = typeof det.similarity === "number" ? det.similarity : 0;
                const isKnown = identity !== "Unknown";
                return (
                  <div key={idx} className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${isKnown ? "bg-white/[0.03]" : "bg-TT-red-accent/10 border border-TT-red-accent/20"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isKnown ? "bg-TT-purple-accent" : "bg-TT-red-accent hud-blink"}`} />
                    <span className={isKnown ? "text-TT-purple-accent" : "text-TT-red-accent font-bold"}>
                      {isKnown ? identity : "UNIDENTIFIED"}
                    </span>
                    <span className="text-white/20">--</span>
                    <span className={isKnown ? "text-white/50" : "text-TT-red-accent/70"}>{(similarity * 100).toFixed(1)}%</span>
                    <span className={`ml-auto uppercase tracking-wider ${isKnown ? "text-TT-purple-accent/50" : "text-TT-red-accent/70 font-bold"}`} style={{ fontSize: "10px" }}>
                      {isKnown ? "[MATCH]" : "[NO MATCH]"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Registration — compact inline */}
        <div className="border-t border-white/[0.06] pt-3">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="w-3.5 h-3.5 text-TT-purple-accent/70" />
            <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Register</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-TT-purple-accent/50" />
              <span className="text-xs font-mono text-white/30">{registeredFaces.length} enrolled</span>
              <Button variant="ghost" size="sm" onClick={fetchRegisteredFaces} className="text-white/30 hover:text-white/60 hover:bg-white/5 h-5 w-5 p-0">
                <RefreshCw className="w-2.5 h-2.5" />
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Name"
              value={newFaceName}
              onChange={(e) => setNewFaceName(e.target.value)}
              disabled={isRegistering}
              className="flex-1 font-mono text-xs h-8 bg-white/[0.03] border-white/10 text-white/80 placeholder:text-white/20 focus:border-TT-purple-accent/50"
            />
            <Button onClick={registerFromCamera} disabled={isRegistering || !newFaceName.trim() || !isCameraOn} size="sm"
              className="h-8 text-xs bg-TT-purple-accent/20 text-TT-purple-accent border border-TT-purple-accent/30 hover:bg-TT-purple-accent/30 disabled:opacity-30">
              <Camera className="w-3 h-3 mr-1" /> Capture
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()} variant="ghost" size="sm" className="h-8 text-xs text-white/40 hover:text-white/60 hover:bg-white/5 border border-white/10">
              <Upload className="w-3 h-3" />
            </Button>
          </div>
          {selectedFile && (
            <div className="flex gap-2 mt-2 items-center">
              <span className="text-xs font-mono text-white/30 truncate flex-1">{selectedFile.name}</span>
              <Button onClick={registerFace} disabled={isRegistering || !newFaceName.trim()} size="sm"
                className="h-7 text-xs bg-TT-purple-accent/20 text-TT-purple-accent border border-TT-purple-accent/30 hover:bg-TT-purple-accent/30 disabled:opacity-30">
                <UserPlus className="w-3 h-3 mr-1" /> Enroll
              </Button>
            </div>
          )}
          {/* Registered faces list */}
          {Array.isArray(registeredFaces) && registeredFaces.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {registeredFaces.map((name) => (
                <div key={name} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
                  <div className="w-1 h-1 rounded-full bg-TT-purple-accent" />
                  <span className="text-xs font-mono text-white/50">{name}</span>
                  <button onClick={() => deleteFace(name)} className="text-white/20 hover:text-TT-red-accent ml-0.5">
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

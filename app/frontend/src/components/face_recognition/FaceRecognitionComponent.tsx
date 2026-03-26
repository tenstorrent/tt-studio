// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Card } from "../ui/card";
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
} from "lucide-react";
import axios from "axios";

interface Detection {
  box?: number[];
  bbox?: number[];
  identity: string;
  similarity: number;
  confidence?: number;
}

export default function FaceRecognitionComponent() {
  const location = useLocation();
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
      setDetections(response.data.faces || []);
      setInferenceMs(response.data.inference_ms);
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
  // Render detection boxes
  const renderDetectionBoxes = () => {
    if (!videoRef.current || !Array.isArray(detections) || detections.length === 0) return null;

    const video = videoRef.current;
    const scaleX = video.clientWidth / (video.videoWidth || 1);
    const scaleY = video.clientHeight / (video.videoHeight || 1);
    return detections.map((det, idx) => {
      // Safety check - skip invalid detections (API returns "box" not "bbox")
      const box = det.box || det.bbox;
      if (!det || !box || !Array.isArray(box) || box.length < 4) {
        return null;
      }

      const [x1, y1, x2, y2] = box;
      const isKnown = det.identity && det.identity !== "Unknown";
      const similarity = typeof det.similarity === "number" ? det.similarity : 0;
      return (
        <div
          key={idx}
          className={`absolute ${isKnown ? "border-green-500" : "border-red-500"} pointer-events-none`}
          style={{
            left: x1 * scaleX,
            top: y1 * scaleY,
            width: (x2 - x1) * scaleX,
            height: (y2 - y1) * scaleY,
            borderWidth: "3px",
            borderStyle: "solid",
          }}
        >
          <div className={`absolute -top-7 left-0 ${isKnown ? "bg-green-600" : "bg-red-600"} text-white text-sm px-2 py-0.5 rounded font-medium whitespace-nowrap`}>
            {det.identity || "Unknown"} ({(similarity * 100).toFixed(0)}%)
          </div>
        </div>
      );
    });
  };
  // No model deployed message
  if (!modelID) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">No Model Deployed</h2>
          <p className="text-muted-foreground">Please deploy the Face Recognition model first.</p>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full gap-4 p-4">
      {/* Main Video Area */}
      <div className="flex-1 flex flex-col">
        <Card className="flex-1 flex flex-col p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Live Face Recognition</h2>
            <div className="flex items-center gap-4">
              {inferenceMs && isLiveMode && (
                <div className="bg-black text-green-400 px-3 py-1 rounded font-mono text-sm">
                  {(1000 / inferenceMs).toFixed(1)} FPS ({inferenceMs.toFixed(0)}ms)
                </div>
              )}
              {isCameraOn ? (
                <Button onClick={stopCamera} variant="destructive" size="sm">
                  <CameraOff className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button onClick={startCamera} size="sm">
                  <Camera className="w-4 h-4 mr-2" />
                  Start
                </Button>
              )}
            </div>
          </div>
          {/* Video Feed */}
          <div className="relative flex-1 bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            {isLiveMode && isCameraOn && renderDetectionBoxes()}
            <canvas ref={canvasRef} className="hidden" />
            {!isCameraOn && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Button onClick={startCamera} size="lg" className="bg-green-600 hover:bg-green-700">
                  <Camera className="w-6 h-6 mr-2" />
                  Start Camera
                </Button>
              </div>
            )}
          </div>
          {/* Detection Results */}
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <h3 className="font-semibold mb-2">
              {!Array.isArray(detections) || detections.length === 0
                ? "No faces detected"
                : `Detected ${detections.length} face${detections.length !== 1 ? "s" : ""}:`}
            </h3>
            {Array.isArray(detections) && detections.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detections.map((det, idx) => {
                  if (!det) return null;
                  const identity = det.identity || "Unknown";
                  const similarity = typeof det.similarity === "number" ? det.similarity : 0;
                  const isKnown = identity !== "Unknown";
                  return (
                    <span
                      key={idx}
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        isKnown
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                      }`}
                    >
                      {identity} ({(similarity * 100).toFixed(0)}%)
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>
      {/* Right Sidebar - Registration */}
      <div className="w-80 flex flex-col gap-4">
        {/* Register New Face */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Register Face
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Name:</label>
              <Input
                placeholder="Enter person's name"
                value={newFaceName}
                onChange={(e) => setNewFaceName(e.target.value)}
                disabled={isRegistering}
              />
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-2">Option 1: Capture from camera</p>
              <Button
                onClick={registerFromCamera}
                disabled={isRegistering || !newFaceName.trim() || !isCameraOn}
                className="w-full"
                variant={isCameraOn && newFaceName.trim() ? "default" : "outline"}
              >
                <Camera className="w-4 h-4 mr-2" />
                {isRegistering ? "Registering..." : !isCameraOn ? "Start camera first" : !newFaceName.trim() ? "Enter name above" : "Capture & Register"}
              </Button>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-2">Option 2: Upload image file</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {selectedFile ? selectedFile.name.substring(0, 20) : "Choose Image File"}
              </Button>
              {selectedFile && (
                <Button
                  onClick={registerFace}
                  disabled={isRegistering || !newFaceName.trim()}
                  className="w-full mt-2"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  {isRegistering ? "Registering..." : !newFaceName.trim() ? "Enter name above" : `Register "${newFaceName}"`}
                </Button>
              )}
            </div>
          </div>
        </Card>
        {/* Registered Faces List */}
        <Card className="p-4 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" />
              Registered ({registeredFaces.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={fetchRegisteredFaces}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!Array.isArray(registeredFaces) || registeredFaces.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No faces registered yet
              </p>
            ) : (
              <ul className="space-y-2">
                {registeredFaces.map((name) => (
                  <li key={name} className="flex items-center justify-between p-2 bg-muted rounded">
                    <span className="text-sm font-medium">{name}</span>
                    <Button variant="ghost" size="sm" onClick={() => deleteFace(name)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

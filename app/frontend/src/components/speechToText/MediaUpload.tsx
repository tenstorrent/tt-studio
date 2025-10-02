// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useRef, useCallback } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  Upload,
  FileVideo,
  Loader2,
  CheckCircle,
  XCircle,
  Play,
  Pause,
  AlertCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useTheme } from "../../providers/ThemeProvider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { 
  extractAudioFromVideo, 
  isValidVideoFile
} from "./lib/mediaConverter";

interface MediaUploadProps {
  onAudioReady: (audioBlob: Blob, metadata: {
    source: 'file';
    filename: string;
    title: string;
  }) => void;
  className?: string;
  disabled?: boolean;
}

type ProcessingState = 'idle' | 'processing' | 'success' | 'error';

interface FileState {
  file: File | null;
  progress: number;
  state: ProcessingState;
  error?: string;
  progressMessage?: string;
}

export function MediaUpload({ onAudioReady, className, disabled = false }: MediaUploadProps) {
  const { theme } = useTheme();
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // File upload state
  const [fileState, setFileState] = useState<FileState>({
    file: null,
    progress: 0,
    state: 'idle',
  });

  // Preview audio state
  const [previewAudio, setPreviewAudio] = useState<{
    blob: Blob | null;
    isPlaying: boolean;
    audioRef: HTMLAudioElement | null;
  }>({
    blob: null,
    isPlaying: false,
    audioRef: null,
  });

  // File drag handlers
  const handleDrag = useCallback((e: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: any) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFileSelection(file);
    }
  }, []);

  // File selection and processing
  const handleFileSelection = async (file: File) => {
    if (!isValidVideoFile(file)) {
      setFileState({
        file: null,
        progress: 0,
        state: 'error',
        error: `Unsupported file type: ${file.type}. Please upload a video file (MP4, WebM, OGG, etc.).`,
      });
      return;
    }

    // Check file size (limit to 100MB for browser processing)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      setFileState({
        file: null,
        progress: 0,
        state: 'error',
        error: `File too large: ${Math.round(file.size / 1024 / 1024)}MB. Maximum size is 100MB.`,
      });
      return;
    }

    setFileState({
      file,
      progress: 0,
      state: 'processing',
      progressMessage: 'Starting audio extraction...',
    });

    try {
      console.log('Processing video file with enhanced processing pipeline:', file.name);
      
      // Progress callback to update UI
      const onProgress = (message: string) => {
        setFileState((prev: any) => ({
          ...prev,
          progressMessage: message,
          progress: message.includes('%') ? 
            parseInt(message.match(/(\d+)%/)?.[1] || '50') : 
            prev.progress
        }));
      };
      
      // Extract audio from video file using enhanced processing pipeline
      const audioBlob = await extractAudioFromVideo(file, 16000, onProgress);
      
      setFileState((prev: any) => ({
        ...prev,
        progress: 100,
        state: 'success',
        progressMessage: 'Audio extraction completed!',
      }));

      // Set preview audio
      setPreviewAudio({
        blob: audioBlob,
        isPlaying: false,
        audioRef: null,
      });

      console.log('Audio extraction completed successfully');
      console.log(`Extracted audio: ${audioBlob.size} bytes, type: ${audioBlob.type}`);

    } catch (error) {
      console.error('Error processing video file:', error);
        // Provide helpful error message with FFmpeg suggestion
        let errorMessage = error instanceof Error ? error.message : 'Failed to extract audio from video';
        
        if (errorMessage.includes('format') || errorMessage.includes('codec') || errorMessage.includes('supported')) {
          errorMessage += '\n\nFor better format support, install FFmpeg.wasm: npm install @ffmpeg/ffmpeg @ffmpeg/core';
        }
        
        setFileState((prev: any) => ({
          ...prev,
          progress: 0,
          state: 'error',
          error: errorMessage,
        }));
    }
  };

  // Send processed audio to parent component
  const sendAudioToTranscription = () => {
    if (!previewAudio.blob || !fileState.file) return;

    const metadata = {
      source: 'file' as const,
      filename: fileState.file.name,
      title: fileState.file.name,
    };

    onAudioReady(previewAudio.blob, metadata);

    // Reset states
    resetStates();
  };

  const resetStates = () => {
    setFileState({
      file: null,
      progress: 0,
      state: 'idle',
    });

    // Clean up audio preview
    if (previewAudio.audioRef) {
      previewAudio.audioRef.pause();
      previewAudio.audioRef.src = '';
    }
    
    setPreviewAudio({
      blob: null,
      isPlaying: false,
      audioRef: null,
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Audio preview controls
  const togglePreviewAudio = () => {
    if (!previewAudio.blob) return;

    if (!previewAudio.audioRef) {
      const audio = new Audio(URL.createObjectURL(previewAudio.blob));
      audio.onended = () => setPreviewAudio((prev: any) => ({ ...prev, isPlaying: false }));
      setPreviewAudio((prev: any) => ({ ...prev, audioRef: audio }));
      audio.play();
      setPreviewAudio((prev: any) => ({ ...prev, isPlaying: true }));
    } else {
      if (previewAudio.isPlaying) {
        previewAudio.audioRef.pause();
        setPreviewAudio((prev: any) => ({ ...prev, isPlaying: false }));
      } else {
        previewAudio.audioRef.play();
        setPreviewAudio((prev: any) => ({ ...prev, isPlaying: true }));
      }
    }
  };

  const hasProcessedAudio = previewAudio.blob && fileState.state === 'success';

  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={cn("w-full", className)}>
      <Card className={cn(
        "p-4 sm:p-6 backdrop-blur-sm shadow-lg",
        theme === "dark" 
          ? "bg-[#222222]/80 border-TT-purple/30" 
          : "bg-white/80 border-TT-purple-shade/30"
      )}>
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h3 className="text-lg font-semibold text-TT-purple mb-2 flex items-center">
            <FileVideo className="h-5 w-5 mr-2" />
            Upload Video File
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Upload MP4, WebM, or other video files to extract audio for transcription
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            "relative border-2 border-dashed rounded-lg p-6 sm:p-8 transition-all duration-200 cursor-pointer",
            dragActive
              ? "border-TT-purple bg-TT-purple/5 scale-[1.02]"
              : "border-gray-300 dark:border-gray-600 hover:border-TT-purple dark:hover:border-TT-purple hover:bg-gray-50 dark:hover:bg-gray-800/50",
            disabled && "opacity-50 cursor-not-allowed",
            fileState.state === 'processing' && "border-TT-purple-accent bg-TT-purple-accent/5"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(e: any) => e.target.files?.[0] && handleFileSelection(e.target.files[0])}
            className="hidden"
            disabled={disabled}
          />
          
          <div className="text-center">
            {fileState.state === 'processing' ? (
              <>
                <Loader2 className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 animate-spin text-TT-purple" />
                <div className="space-y-2">
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                    Extracting audio from video...
                  </p>
                  <div className="max-w-xs mx-auto bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-TT-purple h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: fileState.progress > 0 ? `${fileState.progress}%` : '25%',
                        animation: fileState.progress > 0 ? 'none' : 'pulse 2s infinite'
                      }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {fileState.progressMessage || 'Advanced codec detection and audio processing...'}
                  </p>
                  {fileState.progressMessage?.includes('FFmpeg') ? (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      Using advanced FFmpeg processing for better compatibility
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      Trying multiple extraction methods for best results
                    </p>
                  )}
                </div>
              </>
            ) : fileState.state === 'success' ? (
              <>
                <CheckCircle className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 text-green-500" />
                <p className="text-base font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Audio extracted successfully!
                </p>
                <p className="text-sm text-green-600 dark:text-green-400">
                  Ready for transcription
                </p>
              </>
            ) : fileState.state === 'error' ? (
              <>
                <XCircle className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 text-red-500" />
                <p className="text-base font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Processing failed
                </p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-base font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Drop video file here or click to browse
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Supports MP4, WebM, OGG and other video formats
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                  Maximum file size: 100MB • Recommended: MP4 with H.264 encoding
                </p>
              </>
            )}

            {fileState.file && (
              <div className={cn(
                "mt-4 p-3 rounded-md border text-left",
                theme === "dark" ? "bg-[#1A1A1A] border-gray-700" : "bg-gray-50 border-gray-200"
              )}>
                <div className="flex items-center gap-3">
                  <FileVideo className="h-4 w-4 text-TT-purple flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {fileState.file.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatFileSize(fileState.file.size)}
                    </p>
                  </div>
                  {fileState.state === 'success' && (
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  )}
                </div>
              </div>
            )}

            {fileState.error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <div className="flex items-start">
                  <AlertCircle className="h-4 w-4 text-red-500 mr-2 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-700 dark:text-red-300">
                    {fileState.error?.split('\n').map((line, index) => (
                      <div key={index} className={index > 0 ? 'mt-2' : ''}>
                        {line.startsWith('For better format support') ? (
                          <div className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-2 rounded border border-blue-200 dark:border-blue-800">
                            💡 <strong>Tip:</strong> {line}
                          </div>
                        ) : (
                          <span>{line}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Audio preview and controls */}
        {hasProcessedAudio && (
          <div className={cn(
            "mt-6 p-4 rounded-lg border",
            theme === "dark" ? "bg-[#1A1A1A] border-gray-700" : "bg-gray-50 border-gray-200"
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={togglePreviewAudio}
                        className="h-8 w-8 p-0 hover:bg-TT-purple/10"
                      >
                        {previewAudio.isPlaying ? (
                          <Pause className="h-4 w-4 text-TT-purple" />
                        ) : (
                          <Play className="h-4 w-4 text-TT-purple" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {previewAudio.isPlaying ? "Pause" : "Play"} audio preview
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Audio extracted successfully
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    16kHz WAV format, ready for Whisper transcription
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetStates}
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  Reset
                </Button>
                <Button
                  onClick={sendAudioToTranscription}
                  className="bg-TT-purple-accent hover:bg-TT-purple text-white font-medium"
                >
                  Send to Whisper
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
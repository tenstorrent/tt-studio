import { useTheme } from "../../providers/ThemeProvider";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import {
  Send,
  Mic,
  Trash2 as Trash,
  Square,
  Play,
  Pause,
  Clock,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

type Props = {
  className?: string;
  timerClassName?: string;
  onRecordingComplete?: (audioBlob: Blob) => void;
};

let recorder: MediaRecorder;
let recordingChunks: BlobPart[] = [];
let timerTimeout: NodeJS.Timeout;

// Utility function to pad a number with leading zeros
const padWithLeadingZeros = (num: number, length: number): string => {
  return String(num).padStart(length, "0");
};

export const AudioRecorderWithVisualizer = ({
  className,
  timerClassName,
  onRecordingComplete,
}: Props) => {
  const { theme } = useTheme();

  // States
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isRecordingStopped, setIsRecordingStopped] = useState<boolean>(false);
  const [timer, setTimer] = useState<number>(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [hasRecordedBefore, setHasRecordedBefore] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Calculate the hours, minutes, and seconds from the timer
  const hours = Math.floor(timer / 3600);
  const minutes = Math.floor((timer % 3600) / 60);
  const seconds = timer % 60;

  // Format time for display
  const formattedTime = useMemo(() => {
    return `${padWithLeadingZeros(minutes, 2)}:${padWithLeadingZeros(seconds, 2)}`;
  }, [minutes, seconds]);

  // Refs
  const mediaRecorderRef = useRef<{
    stream: MediaStream | null;
    analyser: AnalyserNode | null;
    mediaRecorder: MediaRecorder | null;
    audioContext: AudioContext | null;
  }>({
    stream: null,
    analyser: null,
    mediaRecorder: null,
    audioContext: null,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  function startRecording() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          audio: true,
        })
        .then((stream) => {
          setIsRecording(true);
          setIsRecordingStopped(false);
          setAudioBlob(null);
          setAudioUrl(null);

          // ============ Analyzing ============
          const AudioContext =
            window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContext();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          mediaRecorderRef.current = {
            stream,
            analyser,
            mediaRecorder: null,
            audioContext: audioCtx,
          };

          // Choose the best supported audio format
          // Important: We need to use audio/webm for most browsers
          // as audio/wav is often not supported by MediaRecorder
          const mimeType = MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/wav")
              ? "audio/wav"
              : "";

          console.log("Using MIME type for recording:", mimeType);

          const options = mimeType ? { mimeType } : undefined;

          // Create and store MediaRecorder instance
          recorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current.mediaRecorder = recorder;

          recordingChunks = [];
          recorder.start();

          recorder.ondataavailable = (e) => {
            recordingChunks.push(e.data);
          };
        })
        .catch((error) => {
          alert("Microphone access error: " + error.message);
          console.error("Microphone access error:", error);
        });
    }
  }
  function stopRecording() {
    if (!isRecording) return;

    recorder.onstop = () => {
      // Create blob from recorded chunks
      // IMPORTANT: Keep the original MIME type from the recorder
      // Don't force audio/wav type here as it might not be WAV format internally
      const recordedMimeType = recorder.mimeType || "audio/webm";
      console.log("Recording MIME type:", recordedMimeType);

      const recordBlob = new Blob(recordingChunks, {
        type: recordedMimeType,
      });

      console.log(
        "Created blob with MIME type:",
        recordBlob.type,
        "Size:",
        recordBlob.size
      );

      setAudioBlob(recordBlob);

      // Create audio URL and set it to state
      const url = URL.createObjectURL(recordBlob);
      setAudioUrl(url);

      recordingChunks = [];
      setHasRecordedBefore(true);
    };

    recorder.stop();
    setIsRecording(false);
    setIsRecordingStopped(true);
    clearTimeout(timerTimeout);
  }
  function sendToAPI() {
    if (!audioBlob) return;

    console.log(
      "Sending to API, blob type:",
      audioBlob.type,
      "size:",
      audioBlob.size
    );

    // Call the callback with the audio blob if provided
    if (onRecordingComplete) {
      onRecordingComplete(audioBlob);
    }

    // Reset states
    setIsRecordingStopped(false);
    setTimer(0);
  }
  function resetRecording() {
    const { mediaRecorder, stream, analyser, audioContext } =
      mediaRecorderRef.current;

    if (mediaRecorder) {
      mediaRecorder.onstop = () => {
        recordingChunks = [];
      };
      mediaRecorder.stop();
    }

    // Stop the web audio context and the analyser node
    if (analyser) {
      analyser.disconnect();
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (audioContext) {
      audioContext.close();
    }

    // Revoke object URL if exists
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    setIsRecording(false);
    setIsRecordingStopped(false);
    setAudioBlob(null);
    setAudioUrl(null);
    setTimer(0);
    clearTimeout(timerTimeout);

    // Clear the animation frame and canvas
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const canvasCtx = canvas.getContext("2d");
      if (canvasCtx) {
        const WIDTH = canvas.width;
        const HEIGHT = canvas.height;
        canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);
      }
    }
  }

  // Toggle audio play/pause
  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Handle audio ended event
  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  // Effect to update the timer every second
  useEffect(() => {
    if (isRecording) {
      timerTimeout = setTimeout(() => {
        setTimer(timer + 1);
      }, 1000);
    }
    return () => clearTimeout(timerTimeout);
  }, [isRecording, timer]);

  // Cleanup effect
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioUrl]);

  // Audio element event listeners
  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
      audioElement.addEventListener("ended", handleAudioEnded);
      return () => {
        audioElement.removeEventListener("ended", handleAudioEnded);
      };
    }
  }, [audioRef.current]);

  // Visualizer
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext("2d");
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    const drawWaveform = (dataArray: Uint8Array) => {
      if (!canvasCtx) return;
      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

      // Create gradient for waveform
      const gradient = canvasCtx.createLinearGradient(0, 0, 0, HEIGHT);

      // Use theme-appropriate colors
      if (theme === "dark") {
        gradient.addColorStop(0, "#c084fc"); // Purple top
        gradient.addColorStop(0.5, "#a855f7"); // Mid purple
        gradient.addColorStop(1, "#7c3aed"); // Deep purple
      } else {
        gradient.addColorStop(0, "#8b5cf6"); // Lighter purple top
        gradient.addColorStop(0.5, "#7c3aed"); // Mid purple
        gradient.addColorStop(1, "#6d28d9"); // Deeper purple
      }

      const barWidth = 4;
      const spacing = 2;
      const maxBarHeight = HEIGHT * 0.8;
      const numBars = Math.floor(WIDTH / (barWidth + spacing));

      for (let i = 0; i < numBars; i++) {
        const value = dataArray[i % dataArray.length] / 255.0;
        const barHeight = Math.max(4, value * maxBarHeight);
        const x = i * (barWidth + spacing);
        const y = (HEIGHT - barHeight) / 2;

        // Add glow effect
        canvasCtx.shadowBlur = 5;
        canvasCtx.shadowColor = theme === "dark" ? "#c084fc" : "#8b5cf6";

        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, y, barWidth, barHeight);

        // Reset shadow for next iteration
        canvasCtx.shadowBlur = 0;
      }
    };

    const visualizeVolume = () => {
      if (!mediaRecorderRef.current?.analyser) return;

      const analyser = mediaRecorderRef.current.analyser;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        if (!isRecording) {
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
          }
          return;
        }
        animationRef.current = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        drawWaveform(dataArray);
      };

      draw();
    };

    if (isRecording) {
      visualizeVolume();
    } else if (isRecordingStopped) {
      // Draw a static waveform when stopped
      const staticData = new Uint8Array(64).fill(128);
      drawWaveform(staticData);
    } else {
      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isRecording, isRecordingStopped, theme]);

  // Get instruction text based on current state
  const getInstructionText = () => {
    if (isRecording) {
      return "Click the stop button when you're done recording.";
    } else if (isRecordingStopped) {
      return "Click the send button to transcribe your recording.";
    } else if (hasRecordedBefore) {
      return "Ready to record another message.";
    } else {
      return "Click the microphone button to start recording.";
    }
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-col space-y-4">
        {/* Timer display */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div
              className={cn(
                "font-mono text-lg font-medium px-3 py-1 rounded-md border",
                isRecording
                  ? "bg-red-500/10 border-red-500/30 text-red-500"
                  : "bg-muted border-border"
              )}
            >
              <Clock className="h-4 w-4 mr-2 inline-block" />
              {formattedTime}
            </div>
            <span className="text-sm font-medium">
              {isRecording
                ? "Recording..."
                : isRecordingStopped
                  ? "Recording Stopped"
                  : "Ready to Record"}
            </span>
          </div>
        </div>

        {/* Waveform container */}
        <div className="w-full h-16 rounded-md border overflow-hidden">
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            width={500}
            height={64}
          />
        </div>

        {/* Audio player - shown after stopping recording */}
        {isRecordingStopped && audioUrl && (
          <div className="w-full mt-4 p-3 bg-muted/20 rounded-md border border-border">
            <div className="flex justify-between items-center mb-2">
              <p className="text-sm font-medium">Preview Recording:</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={togglePlayPause}
                className="h-8 w-8 p-0 flex items-center justify-center"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </div>
            <audio
              ref={audioRef}
              className="w-full"
              src={audioUrl}
              controls
              onEnded={handleAudioEnded}
              style={{ display: "block" }}
            />
          </div>
        )}

        {/* Controls - centered with larger buttons */}
        <div className="flex justify-center items-center space-x-4 mt-4">
          {/* Reset button */}
          {(isRecording || isRecordingStopped) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={resetRecording}
                    className="h-12 w-12 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-700 border-0 text-white"
                    style={{ color: "white", backgroundColor: "#dc2626" }}
                  >
                    <Trash className="h-5 w-5" style={{ color: "white" }} />
                    <span className="sr-only">Reset recording</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Reset recording</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Stop button */}
          {isRecording && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={stopRecording}
                    className="h-12 w-12 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-700 border-0"
                    style={{ backgroundColor: "#e5e7eb", color: "#000" }}
                  >
                    <Square
                      className="h-5 w-5"
                      style={{ color: "currentColor" }}
                    />
                    <span className="sr-only">Stop recording</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Stop recording</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {!isRecording && !isRecordingStopped && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Modified to ensure visible in both light and dark themes */}
                  <div
                    onClick={startRecording}
                    className="h-16 w-16 rounded-full relative flex items-center justify-center bg-white dark:bg-gray-800 border-2 border-purple-500 cursor-pointer shadow-lg"
                    style={{ boxShadow: "0 0 0 2px rgba(168, 85, 247, 0.5)" }}
                  >
                    <Mic
                      className="h-7 w-7 text-purple-600 dark:text-purple-400"
                      style={{ color: "rgb(147, 51, 234)" }}
                    />
                    {hasRecordedBefore && (
                      <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
                    )}
                    <span className="sr-only">Start recording</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {hasRecordedBefore
                    ? "Click to record again"
                    : "Click to start recording"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Send to API button */}
          {isRecordingStopped && audioBlob && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={sendToAPI}
                    className="h-12 px-6 rounded-full flex items-center bg-purple-600 hover:bg-purple-700 text-white border-0"
                    style={{ backgroundColor: "#9333ea", color: "white" }}
                  >
                    <Send className="h-5 w-5 mr-2" style={{ color: "white" }} />
                    <span>Send</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Send recording for transcription
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Instruction text */}
        <p className="text-sm text-muted-foreground text-center mt-2">
          {getInstructionText()}
        </p>
      </div>
    </div>
  );
};

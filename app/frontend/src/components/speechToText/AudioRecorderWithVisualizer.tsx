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
  // const hours = Math.floor(timer / 3600);
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

  const sampleRate = 16_000; // 16kHz sample rate

  function startRecording() {
    if (mediaRecorderRef.current.stream) {
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
      mediaRecorderRef.current.stream = null;
    }

    if (
      mediaRecorderRef.current.audioContext &&
      mediaRecorderRef.current.audioContext.state !== "closed"
    ) {
      mediaRecorderRef.current.audioContext.close().catch((err) => {
        console.error("Error closing previous AudioContext:", err);
      });
      mediaRecorderRef.current.audioContext = null;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          audio: { sampleRate },
        })
        .then((stream) => {
          setIsRecording(true);
          setIsRecordingStopped(false);
          setAudioBlob(null);
          setAudioUrl(null);

          // ============ Analyzing ============
          const AudioContext =
            window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContext({ sampleRate });
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

      // Clear the recording chunks array
      recordingChunks = [];

      // Completely release the microphone by stopping all tracks
      if (mediaRecorderRef.current.stream) {
        console.log("Stopping all tracks and releasing microphone");
        mediaRecorderRef.current.stream.getTracks().forEach((track) => {
          track.stop();
          console.log("Track stopped:", track.kind);
        });
        mediaRecorderRef.current.stream = null;
      }

      // Clear the mediaRecorder reference
      mediaRecorderRef.current.mediaRecorder = null;

      // Also close the audio context to fully release audio resources
      if (
        mediaRecorderRef.current.audioContext &&
        mediaRecorderRef.current.audioContext.state !== "closed"
      ) {
        mediaRecorderRef.current.audioContext
          .close()
          .then(() => {
            console.log("AudioContext closed successfully");
          })
          .catch((err) => {
            console.error("Error closing AudioContext:", err);
          });
        mediaRecorderRef.current.audioContext = null;
      }

      // Disconnect the analyser if it exists
      if (mediaRecorderRef.current.analyser) {
        mediaRecorderRef.current.analyser.disconnect();
        mediaRecorderRef.current.analyser = null;
      }

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

    // Reset recording states and clear audio UI but preserve the actual blob
    // for the conversation view
    setIsRecordingStopped(false);
    setAudioUrl(null); // Clear the audio URL to hide the player
    setTimer(0);

    // Clear the canvas
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

    // Reset all state
    mediaRecorderRef.current = {
      stream: null,
      analyser: null,
      mediaRecorder: null,
      audioContext: null,
    };

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

      // Make sure to fully clean up all audio resources when component unmounts
      const { stream, audioContext, analyser } = mediaRecorderRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      if (analyser) {
        analyser.disconnect();
      }

      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch((err) => {
          console.error("Error closing AudioContext on unmount:", err);
        });
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

    const drawWaveform = (
      dataArray: string | any[] | Uint8Array<ArrayBuffer>
    ) => {
      if (!canvasCtx) return;
      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

      // Create gradient for waveform using TT color palette
      const gradient = canvasCtx.createLinearGradient(0, 0, 0, HEIGHT);

      // Use theme-appropriate colors from the TT palette
      if (
        theme === "dark" ||
        document.documentElement.classList.contains("dark")
      ) {
        gradient.addColorStop(0, "#D0C6FF"); // TT.purple.tint1
        gradient.addColorStop(0.5, "#BCB3F7"); // TT.purple.DEFAULT
        gradient.addColorStop(1, "#7C68FA"); // TT.purple.accent
      } else {
        gradient.addColorStop(0, "#BCB3F7"); // TT.purple.DEFAULT
        gradient.addColorStop(0.5, "#7C68FA"); // TT.purple.accent
        gradient.addColorStop(1, "#4B456E"); // TT.purple.shade
      }

      const barWidth = 4;
      const spacing = 2;
      const maxBarHeight = HEIGHT * 0.8;
      const numBars = Math.floor(WIDTH / (barWidth + spacing));

      // Add some visual dynamics based on frequency analysis
      for (let i = 0; i < numBars; i++) {
        // Get normalized value (0-1) from the data array
        const value = dataArray[i % dataArray.length] / 255.0;

        // Calculate amplitude-based bar height with a minimum size
        const barHeight = Math.max(4, value * maxBarHeight);

        // Position calculations
        const x = i * (barWidth + spacing);
        const y = (HEIGHT - barHeight) / 2;

        // Enhanced glow effect - stronger in dark mode
        canvasCtx.shadowBlur = theme === "dark" ? 8 : 6;
        canvasCtx.shadowColor = theme === "dark" ? "#7C68FA" : "#BCB3F7"; // TT.purple.accent or TT.purple.DEFAULT

        // Apply subtle amplitude-based color variation
        if (value > 0.7) {
          // High amplitude - use accent color with more glow
          canvasCtx.fillStyle = theme === "dark" ? "#D0C6FF" : "#7C68FA"; // TT.purple.tint1 or TT.purple.accent
          canvasCtx.shadowBlur = theme === "dark" ? 12 : 8;
        } else {
          // Normal amplitude - use gradient
          canvasCtx.fillStyle = gradient;
        }

        // Draw bar with rounded top
        canvasCtx.beginPath();
        canvasCtx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        canvasCtx.fill();

        // Reset shadow for next iteration
        canvasCtx.shadowBlur = 0;
      }
    };

    // Update the visualizeVolume function to add a slight animation effect
    const visualizeVolume = () => {
      if (!mediaRecorderRef.current?.analyser) return;

      const analyser = mediaRecorderRef.current.analyser;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // For animation effect
      let frameCount = 0;

      const draw = () => {
        if (!isRecording) {
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
          }
          return;
        }

        frameCount++;
        animationRef.current = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        // Apply subtle animation enhancement to the visualization
        const enhancedData = new Uint8Array(dataArray.length);
        for (let i = 0; i < dataArray.length; i++) {
          // Add a subtle wave effect based on frameCount
          const pulseFactor = 1 + 0.05 * Math.sin(frameCount * 0.05 + i * 0.1);
          enhancedData[i] = Math.min(
            255,
            Math.floor(dataArray[i] * pulseFactor)
          );
        }

        drawWaveform(enhancedData);
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
      <div className="flex flex-col space-y-3 sm:space-y-4">
        {/* Timer display */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div
              className={cn(
                "font-mono text-base sm:text-lg font-medium px-2 sm:px-3 py-1 rounded-md border",
                isRecording
                  ? "bg-red-500/10 border-red-500/30 text-red-500"
                  : "bg-muted border-border dark:bg-[#222222] dark:border-TT-purple/20 dark:text-gray-200"
              )}
            >
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 inline-block text-TT-purple dark:text-TT-purple-accent" />
              {formattedTime}
            </div>
            <span className="text-xs sm:text-sm font-medium dark:text-gray-300">
              {isRecording
                ? "Recording..."
                : isRecordingStopped
                  ? "Recording Stopped"
                  : "Ready to Record"}
            </span>
          </div>
        </div>

        {/* Waveform container */}
        <div className="w-full h-12 sm:h-16 rounded-md border overflow-hidden dark:border-TT-purple/20 bg-white dark:bg-[#222222]">
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            width={500}
            height={64}
          />
        </div>

        {/* Audio player - shown after stopping recording */}
        {isRecordingStopped && audioUrl && (
          <div className="w-full mt-3 sm:mt-4 p-2 sm:p-3 rounded-md border bg-white/50 dark:bg-[#1A1A1A]/90 backdrop-blur-sm border-border dark:border-TT-purple/20">
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={togglePlayPause}
                className="h-8 w-8 p-0 flex items-center justify-center text-TT-purple-accent hover:text-TT-purple-shade hover:bg-TT-purple/10 dark:text-TT-purple dark:hover:text-TT-purple-tint1 dark:hover:bg-TT-purple/20"
              >
                {isPlaying ? (
                  <Pause className="h-3 w-3 sm:h-4 sm:w-4" />
                ) : (
                  <Play className="h-3 w-3 sm:h-4 sm:w-4" />
                )}
              </Button>
              <div className="flex-1">
                <audio
                  ref={audioRef}
                  className="w-full 
                    [&::-webkit-media-controls-panel]:bg-white/50 
                    [&::-webkit-media-controls-panel]:dark:bg-[#1A1A1A]/90
                    [&::-webkit-media-controls-play-button]:hidden 
                    [&::-webkit-media-controls-current-time-display]:text-gray-700 
                    [&::-webkit-media-controls-current-time-display]:dark:text-gray-200
                    [&::-webkit-media-controls-time-remaining-display]:text-gray-700 
                    [&::-webkit-media-controls-time-remaining-display]:dark:text-gray-200
                    [&::-webkit-media-controls-timeline]:accent-TT-purple"
                  src={audioUrl}
                  controls
                  onEnded={handleAudioEnded}
                  style={{ height: "32px" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Controls - centered with larger buttons */}
        <div className="flex justify-center items-center space-x-3 sm:space-x-4 mt-3 sm:mt-4">
          {/* Reset button */}
          {(isRecording || isRecordingStopped) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={resetRecording}
                    className="h-10 w-10 sm:h-12 sm:w-12 rounded-full flex items-center justify-center bg-TT-red-accent hover:bg-TT-red-shade border-0 text-white transition-colors duration-200"
                  >
                    <Trash className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
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
                    className="h-10 w-10 sm:h-12 sm:w-12 rounded-full flex items-center justify-center bg-TT-red hover:bg-TT-red-accent border-0 transition-colors duration-200"
                  >
                    <Square className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
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
                  <div
                    onClick={startRecording}
                    className="h-14 w-14 sm:h-16 sm:w-16 rounded-full relative flex items-center justify-center bg-white dark:bg-[#222222] border-2 border-TT-purple-accent cursor-pointer shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 hover:shadow-TT-purple-accent/30 dark:hover:shadow-TT-purple/30 hover:border-TT-purple dark:hover:border-TT-purple-tint1"
                    style={{
                      boxShadow: "0 0 0 2px rgba(124, 104, 250, 0.3)", // TT-purple-accent with opacity
                      transform: "translateY(0)",
                      transition:
                        "transform 0.2s, box-shadow 0.2s, border-color 0.2s",
                    }}
                  >
                    <Mic className="h-6 w-6 sm:h-7 sm:w-7 text-TT-purple-accent dark:text-TT-purple-tint1 transition-colors duration-200" />
                    {hasRecordedBefore && (
                      <span className="absolute -top-1 -right-1 h-3 w-3 bg-TT-red rounded-full"></span>
                    )}
                    <span className="sr-only">Start recording</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-TT-purple-accent" />
                    {hasRecordedBefore
                      ? "Click to record again"
                      : "Click to start recording"}
                  </div>
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
                    className="h-10 sm:h-12 px-4 sm:px-6 rounded-full flex items-center bg-TT-purple-accent hover:bg-TT-purple-shade text-white border-0"
                  >
                    <Send className="h-4 w-4 sm:h-5 sm:w-5 mr-2 text-white" />
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
        <p className="text-xs sm:text-sm text-muted-foreground dark:text-gray-400 text-center mt-2">
          {getInstructionText()}
        </p>
      </div>
    </div>
  );
};

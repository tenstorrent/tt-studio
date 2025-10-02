/**
 * FFmpeg.wasm integration for robust video-to-audio conversion
 * Fallback solution for videos that browser-native APIs cannot handle
 */

// Types for FFmpeg.wasm (to be installed: @ffmpeg/ffmpeg @ffmpeg/core)
interface FFmpegInstance {
  load(): Promise<void>;
  writeFile(filename: string, data: Uint8Array): Promise<void>;
  exec(args: string[]): Promise<void>;
  readFile(filename: string): Promise<Uint8Array>;
  deleteFile(filename: string): Promise<void>;
  terminate(): Promise<void>;
  loaded: boolean;
  setProgress?(callback: (progress: { ratio: number; time: number }) => void): void;
}

declare global {
  interface Window {
    FFmpeg?: {
      createFFmpeg: (config?: { log?: boolean; corePath?: string }) => FFmpegInstance;
    };
  }
}

let ffmpegInstance: FFmpegInstance | null = null;
let isFFmpegLoading = false;

/**
 * Load FFmpeg.wasm library dynamically
 * Only loads when needed to avoid impacting initial page load
 */
async function loadFFmpeg(onProgress?: (progress: string) => void): Promise<FFmpegInstance> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (isFFmpegLoading) {
    // Wait for existing load to complete
    while (isFFmpegLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpegInstance && ffmpegInstance.loaded) {
      return ffmpegInstance;
    }
  }

  isFFmpegLoading = true;
  
  try {
    onProgress?.('Loading FFmpeg library (this may take a moment)...');
    
    // Check if FFmpeg is already available globally
    if (!window.FFmpeg) {
      // Dynamically import FFmpeg.wasm (only works when packages are installed)
      const ffmpegModule = await import('@ffmpeg/ffmpeg').catch(() => {
        throw new Error('FFmpeg.wasm not installed. Run: npm install @ffmpeg/ffmpeg @ffmpeg/core');
      });
      const coreModule = await import('@ffmpeg/core').catch(() => {
        throw new Error('FFmpeg core not installed. Run: npm install @ffmpeg/ffmpeg @ffmpeg/core');
      });
      
      // Set up FFmpeg with core path
      window.FFmpeg = {
        createFFmpeg: (config) => (ffmpegModule as any).createFFmpeg({
          ...config,
          corePath: (coreModule as any).default || '/node_modules/@ffmpeg/core/dist/ffmpeg-core.js'
        })
      };
    }

    onProgress?.('Initializing FFmpeg...');
    
    // Create FFmpeg instance
    ffmpegInstance = window.FFmpeg.createFFmpeg({ 
      log: false, // Set to true for debugging
    });

    // Set up progress callback if supported
    if (ffmpegInstance.setProgress) {
      ffmpegInstance.setProgress(({ ratio }) => {
        onProgress?.(`Processing video: ${Math.round(ratio * 100)}%`);
      });
    }

    // Load FFmpeg
    await ffmpegInstance.load();
    
    onProgress?.('FFmpeg ready!');
    console.log('FFmpeg.wasm loaded successfully');
    
    return ffmpegInstance;
    
  } catch (error) {
    console.error('Failed to load FFmpeg.wasm:', error);
    throw new Error(`Could not load FFmpeg: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    isFFmpegLoading = false;
  }
}

/**
 * Extract audio from video using FFmpeg.wasm
 * This method is more robust than browser-native APIs
 */
export async function extractAudioWithFFmpeg(
  videoFile: Blob,
  onProgress?: (progress: string) => void
): Promise<Blob> {
  try {
    onProgress?.('Preparing FFmpeg for video processing...');
    
    // Load FFmpeg
    const ffmpeg = await loadFFmpeg(onProgress);

    // Create unique filenames to avoid conflicts
    const inputFilename = `input_${Date.now()}.mp4`;
    const outputFilename = `output_${Date.now()}.wav`;

    try {
      onProgress?.('Reading video file...');
      
      // Convert Blob to Uint8Array
      const videoBuffer = await videoFile.arrayBuffer();
      const videoData = new Uint8Array(videoBuffer);

      onProgress?.('Writing video to FFmpeg filesystem...');
      
      // Write input file to FFmpeg virtual filesystem
      await ffmpeg.writeFile(inputFilename, videoData);

      onProgress?.('Converting video to audio (this may take a while)...');
      
      // Run FFmpeg command to extract audio
      // -i: input file
      // -vn: disable video stream
      // -acodec pcm_s16le: use 16-bit PCM audio codec
      // -ar 16000: set sample rate to 16kHz (required by Whisper)
      // -ac 2: set to stereo (2 channels)
      // -f wav: output format WAV
      await ffmpeg.exec([
        '-i', inputFilename,
        '-vn',                    // No video
        '-acodec', 'pcm_s16le',   // 16-bit PCM
        '-ar', '16000',           // 16kHz sample rate
        '-ac', '2',               // Stereo
        '-f', 'wav',              // WAV format
        outputFilename
      ]);

      onProgress?.('Reading processed audio...');
      
      // Read the output file
      const audioData = await ffmpeg.readFile(outputFilename);
      
      // Create blob from the processed audio
      const audioBlob = new Blob([audioData.buffer], { type: 'audio/wav' });

      onProgress?.('Audio extraction completed successfully!');
      
      console.log('FFmpeg audio extraction successful:', {
        originalSize: videoFile.size,
        extractedSize: audioBlob.size,
        format: 'WAV 16kHz'
      });

      return audioBlob;

    } finally {
      // Clean up temporary files
      try {
        await ffmpeg.deleteFile(inputFilename);
        await ffmpeg.deleteFile(outputFilename);
      } catch (cleanupError) {
        console.warn('FFmpeg cleanup warning:', cleanupError);
      }
    }

  } catch (error) {
    console.error('FFmpeg processing error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('load')) {
        throw new Error('Failed to load FFmpeg library. Please check your internet connection and try again.');
      } else if (error.message.includes('exec') || error.message.includes('command')) {
        throw new Error('Video processing failed. The file may be corrupted or in an unsupported format.');
      }
    }
    
    throw new Error(`FFmpeg processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check if FFmpeg.wasm is available
 * Used to conditionally show FFmpeg option in UI
 */
export function isFFmpegAvailable(): boolean {
  try {
    // Check if we're in a browser environment
    // FFmpeg.wasm can potentially be loaded if we're in a browser
    // Actual package availability is checked during import attempt
    return typeof window !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Terminate FFmpeg instance to free up memory
 * Call this when done with video processing
 */
export async function terminateFFmpeg(): Promise<void> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    try {
      await ffmpegInstance.terminate();
      ffmpegInstance = null;
      console.log('FFmpeg instance terminated');
    } catch (error) {
      console.warn('FFmpeg termination warning:', error);
    }
  }
}

/**
 * Get estimated processing time based on file size
 * Used for user feedback and timeout calculations
 */
export function getEstimatedProcessingTime(fileSizeBytes: number): number {
  // Rough estimation: 1MB takes ~2 seconds on average hardware
  const estimatedSeconds = Math.max(10, (fileSizeBytes / (1024 * 1024)) * 2);
  return Math.min(estimatedSeconds, 300); // Cap at 5 minutes
}

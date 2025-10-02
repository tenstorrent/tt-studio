/**
 * Enhanced video-to-audio conversion using OfflineAudioContext for better performance
 */

/**
 * Extract audio from video file and convert to WAV using OfflineAudioContext
 * This approach provides much better performance than real-time processing
 */
export async function extractAudioFromVideo(
  videoFile: Blob,
  targetSampleRate = 16_000, // 16kHz for Whisper
): Promise<Blob> {
  try {
    // Step 1: Load video and get duration info
    const videoInfo = await getVideoInfo(videoFile);
    
    // Step 2: Extract raw audio data from video
    const audioBuffer = await extractAudioBuffer(videoFile, videoInfo.duration);
    
    // Step 3: Process with OfflineAudioContext for optimal performance
    const processedBuffer = await processAudioOffline(audioBuffer, targetSampleRate);
    
    // Step 4: Convert to WAV blob
    const wavBlob = audioBufferToWav(processedBuffer);
    
    console.log('Audio extraction completed successfully with OfflineAudioContext');
    return wavBlob;
    
  } catch (error) {
    console.error('Error in extractAudioFromVideo:', error);
    throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get video metadata (duration, etc.) needed for audio processing
 */
async function getVideoInfo(videoFile: Blob): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(video.src);
      
      if (!isFinite(duration) || duration <= 0) {
        reject(new Error('Invalid video duration'));
        return;
      }
      
      resolve({ duration });
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video metadata'));
    };
    
    const videoUrl = URL.createObjectURL(videoFile);
    video.src = videoUrl;
  });
}

/**
 * Extract audio data from video using Web Audio API
 * This captures the full audio without real-time playback constraints
 */
async function extractAudioBuffer(videoFile: Blob, duration: number): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    video.muted = true;
    video.crossOrigin = 'anonymous';
    
    let audioBuffer: AudioBuffer | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let audioData: Float32Array[] = [];
    let expectedSamples: number;
    let collectedSamples = 0;
    
    const cleanup = () => {
      if (processor) {
        processor.disconnect();
        processor = null;
      }
      if (source) {
        source.disconnect();
        source = null;
      }
      if (audioContext.state !== 'closed') {
        audioContext.close().catch(console.error);
      }
      URL.revokeObjectURL(video.src);
    };
    
    video.onloadedmetadata = () => {
      try {
        // Calculate expected samples
        expectedSamples = Math.ceil(duration * audioContext.sampleRate);
        
        // Set up audio processing chain
        source = audioContext.createMediaElementSource(video);
        
        // Use ScriptProcessorNode for audio data capture
        // Buffer size of 4096 provides good balance of performance and latency
        processor = audioContext.createScriptProcessor(4096, 2, 2);
        
        processor.onaudioprocess = (event) => {
          const inputBuffer = event.inputBuffer;
          const leftChannel = inputBuffer.getChannelData(0);
          const rightChannel = inputBuffer.numberOfChannels > 1 ? 
            inputBuffer.getChannelData(1) : leftChannel;
          
          // Store audio data for both channels
          if (!audioData[0]) audioData[0] = new Float32Array(expectedSamples);
          if (!audioData[1]) audioData[1] = new Float32Array(expectedSamples);
          
          // Copy data to our buffers
          const samplesToProcess = Math.min(
            leftChannel.length, 
            expectedSamples - collectedSamples
          );
          
          for (let i = 0; i < samplesToProcess; i++) {
            if (collectedSamples + i < expectedSamples) {
              audioData[0][collectedSamples + i] = leftChannel[i];
              audioData[1][collectedSamples + i] = rightChannel[i];
            }
          }
          
          collectedSamples += samplesToProcess;
        };
        
        // Connect the audio graph
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Set up video playback completion handler
        video.onended = () => {
          try {
            // Create AudioBuffer from collected data
            const channels = audioData[1] ? 2 : 1;
            audioBuffer = audioContext.createBuffer(
              channels, 
              collectedSamples, 
              audioContext.sampleRate
            );
            
            // Copy data to AudioBuffer
            audioBuffer.copyToChannel(audioData[0].slice(0, collectedSamples), 0);
            if (channels === 2 && audioData[1]) {
              audioBuffer.copyToChannel(audioData[1].slice(0, collectedSamples), 1);
            }
            
            cleanup();
            resolve(audioBuffer);
          } catch (error) {
            cleanup();
            reject(error);
          }
        };
        
        video.onerror = (error) => {
          cleanup();
          reject(new Error(`Video playback error: ${error}`));
        };
        
        // Start audio extraction process
        // Use faster playback rate for quicker processing
        video.playbackRate = 4.0; // 4x speed for faster extraction
        video.play().catch((error) => {
          cleanup();
          reject(new Error(`Failed to start video playback: ${error}`));
        });
        
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    
    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video file'));
    };
    
    // Load the video
    const videoUrl = URL.createObjectURL(videoFile);
    video.src = videoUrl;
  });
}

/**
 * Process audio buffer using OfflineAudioContext for maximum performance
 * This handles resampling and format conversion without real-time constraints
 */
async function processAudioOffline(
  inputBuffer: AudioBuffer, 
  targetSampleRate: number
): Promise<AudioBuffer> {
  const inputSampleRate = inputBuffer.sampleRate;
  const inputChannels = inputBuffer.numberOfChannels;
  
  // Calculate output length based on sample rate conversion
  const outputLength = Math.ceil(
    inputBuffer.length * targetSampleRate / inputSampleRate
  );
  
  // Create OfflineAudioContext with target specifications
  const offlineContext = new OfflineAudioContext(
    Math.min(inputChannels, 2), // Max 2 channels for WAV compatibility
    outputLength,
    targetSampleRate
  );
  
  try {
    // Create buffer source
    const source = offlineContext.createBufferSource();
    source.buffer = inputBuffer;
    
    // Connect directly to destination for clean processing
    source.connect(offlineContext.destination);
    
    // Process the entire buffer instantly
    source.start(0);
    const processedBuffer = await offlineContext.startRendering();
    
    console.log(`Audio processed: ${inputSampleRate}Hz → ${targetSampleRate}Hz, ${inputChannels} channels → ${processedBuffer.numberOfChannels} channels`);
    
    return processedBuffer;
    
  } catch (error) {
    throw new Error(`OfflineAudioContext processing failed: ${error}`);
  }
}

/**
 * Convert AudioBuffer to WAV blob with proper headers
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM format
  const bitDepth = 16; // 16-bit audio
  
  // Interleave channels if stereo
  let audioData: Float32Array;
  if (numberOfChannels === 2) {
    audioData = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    audioData = buffer.getChannelData(0);
  }
  
  return encodeWAV(audioData, format, sampleRate, numberOfChannels, bitDepth);
}

/**
 * Interleave left and right audio channels
 */
function interleave(leftChannel: Float32Array, rightChannel: Float32Array): Float32Array {
  const length = leftChannel.length + rightChannel.length;
  const result = new Float32Array(length);
  
  let index = 0;
  let inputIndex = 0;
  
  while (index < length) {
    result[index++] = leftChannel[inputIndex];
    result[index++] = rightChannel[inputIndex];
    inputIndex++;
  }
  
  return result;
}

/**
 * Encode audio data as WAV format with proper RIFF header
 */
function encodeWAV(
  samples: Float32Array,
  format: number,
  sampleRate: number,
  numChannels: number,
  bitDepth: number,
): Blob {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  // Create WAV file buffer (44 bytes header + audio data)
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  
  // WAV file header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Format chunk size
  view.setUint16(20, format, true); // Audio format (PCM)
  view.setUint16(22, numChannels, true); // Number of channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * blockAlign, true); // Byte rate
  view.setUint16(32, blockAlign, true); // Block align
  view.setUint16(34, bitDepth, true); // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  
  // Convert float samples to 16-bit PCM
  floatTo16BitPCM(view, 44, samples);
  
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Write string to DataView at specified offset
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Convert float audio samples to 16-bit PCM
 */
function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

/**
 * Validate if a file is a supported video format
 */
export function isValidVideoFile(file: File): boolean {
  const supportedTypes = [
    'video/mp4',
    'video/webm', 
    'video/ogg',
    'video/avi',
    'video/mov',
    'video/quicktime',
    'video/x-msvideo'
  ];
  
  return supportedTypes.some(type => 
    file.type.includes(type.split('/')[1]) || 
    file.name.toLowerCase().endsWith('.' + type.split('/')[1])
  );
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}
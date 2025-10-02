# FFmpeg.wasm Integration Setup

This document explains how to set up FFmpeg.wasm for enhanced video processing capabilities in the speech-to-text feature.

## Installation

To enable FFmpeg.wasm support for processing problematic video files, install the required dependencies:

```bash
npm install @ffmpeg/ffmpeg @ffmpeg/core
```

Or using yarn:

```bash
yarn add @ffmpeg/ffmpeg @ffmpeg/core
```

## What This Enables

With FFmpeg.wasm installed, the video upload feature will have **four processing methods**:

1. **Browser Native Video Processing** (fastest, works with standard H.264 MP4s)
2. **Alternative Audio Element Processing** (fallback for some problematic files)
3. **FFmpeg.wasm Processing** ⭐ (robust, handles almost any video format)
4. **Estimated Duration Processing** (last resort)

## How It Works

### Processing Pipeline

The system will automatically try each method in order:

```
Upload Video File
       ↓
Try Browser Native Processing
       ↓ (if fails)
Try Alternative Audio Processing  
       ↓ (if fails)
Try FFmpeg.wasm Processing ← Your problematic MP4 will likely succeed here
       ↓ (if fails)
Try Estimated Duration Processing
       ↓ (if fails)  
Show User-Friendly Error Message
```

### FFmpeg Command Used

The system runs the equivalent of this FFmpeg command:

```bash
ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 2 -f wav output.wav
```

**Parameters explained:**
- `-i input.mp4`: Input video file
- `-vn`: No video (audio only)
- `-acodec pcm_s16le`: 16-bit PCM audio codec
- `-ar 16000`: 16kHz sample rate (required by Whisper)
- `-ac 2`: Stereo audio (2 channels)
- `-f wav`: Output format WAV

### User Experience

**Without FFmpeg.wasm:**
- ❌ Your MP4 file fails with "Video format not supported"

**With FFmpeg.wasm:**
- ✅ Browser tries native processing first (fast)
- ✅ If that fails, automatically switches to FFmpeg processing
- ✅ Shows progress: "Loading FFmpeg library... → Processing video: 45% → Completed!"
- ✅ Successfully extracts audio from virtually any video format

## Performance Impact

### Loading Time
- **First use**: ~3-5 seconds to download FFmpeg.wasm (~20MB)
- **Subsequent uses**: Instant (cached in browser)

### Processing Time
- **Small videos** (<10MB): ~5-15 seconds
- **Medium videos** (10-50MB): ~15-60 seconds  
- **Large videos** (50-100MB): ~1-3 minutes

### Memory Usage
- FFmpeg.wasm uses ~50-100MB RAM during processing
- Automatically cleans up after completion

## File Format Support

With FFmpeg.wasm, the system supports:

**Video Formats:**
- MP4 (any codec: H.264, H.265/HEVC, AV1, etc.)
- WebM (VP8, VP9, AV1)
- AVI (DivX, Xvid, etc.)
- MOV/QuickTime
- MKV (Matroska)
- FLV (Flash Video)
- 3GP, M4V, and many more

**Audio Codecs:**
- AAC, MP3, AC3, DTS
- Opus, Vorbis, FLAC
- PCM variants
- And virtually any audio codec FFmpeg supports

## Troubleshooting

### FFmpeg Won't Load
**Error:** "Failed to load FFmpeg library"
**Solution:** Check internet connection. FFmpeg.wasm downloads from CDN on first use.

### Out of Memory
**Error:** Processing fails on very large files
**Solution:** Try smaller video files or use a device with more RAM.

### Still Getting Format Errors
**Error:** Even FFmpeg fails
**Solution:** The video file may be severely corrupted. Try re-encoding with standard tools.

## Development Notes

### Code Structure
```
lib/
├── mediaConverter.ts       # Main processing pipeline
├── ffmpegProcessor.ts      # FFmpeg.wasm integration
└── apiClient.tsx          # Sends processed audio to Whisper
```

### Integration Points
- FFmpeg is loaded **only when needed** (not on initial page load)
- Progress callbacks provide real-time user feedback
- Automatic cleanup prevents memory leaks
- Graceful fallback if FFmpeg unavailable

### Testing
To test FFmpeg functionality:
1. Upload a standard MP4 → should use browser native processing
2. Upload a problematic MP4 (like yours) → should automatically use FFmpeg
3. Check browser console for processing method used

## Browser Support

FFmpeg.wasm requires:
- **Chrome 57+** (recommended)
- **Firefox 52+**
- **Safari 11+**
- **Edge 16+**

Older browsers will fall back to native processing only.

## Security

FFmpeg.wasm runs entirely in the browser:
- ✅ No video data sent to external servers
- ✅ Processing happens locally on user's device
- ✅ No network requests during video processing
- ✅ Same security model as browser-native processing

---

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install @ffmpeg/ffmpeg @ffmpeg/core
   ```

2. **Test with your problematic MP4:**
   - Upload your file
   - Watch console logs to see processing method used
   - Should automatically use FFmpeg and succeed

3. **Enjoy robust video processing!**
   - Supports virtually any video format
   - Clear progress feedback
   - Automatic fallback system

# Document Upload Size Limit Changes

## Summary
Increased maximum file upload size from **1 MB to 25 MB** and added comprehensive user experience improvements.

---

## Changes Made

### 1. Nginx Configuration
**File:** `app/frontend/nginx.conf:7`

**Change:** Added client max body size directive
```nginx
# Allow uploads up to 25 MB
client_max_body_size 25M;
```

**Impact:** Nginx now accepts files up to 25 MB instead of the default 1 MB

---

### 2. Django Backend Settings
**File:** `app/backend/api/settings.py:197-199`

**Change:** Added explicit file upload size limits
```python
# File upload size limits
DATA_UPLOAD_MAX_MEMORY_SIZE = 26214400  # 25 MB in bytes
FILE_UPLOAD_MAX_MEMORY_SIZE = 26214400  # 25 MB in bytes
```

**Impact:** Django backend now accepts files up to 25 MB

---

### 3. Backend Validation & Error Messages
**File:** `app/backend/vector_db_control/views.py:277-291`

**Change:** Added file size validation with clear error messages
```python
# Check file size (25 MB limit)
max_size = 26214400  # 25 MB in bytes
if document.size > max_size:
    logger.warning(f"File {document.name} rejected: size {document.size} bytes exceeds {max_size} bytes")
    return Response(
        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        data={
            "error": f"File size ({(document.size / (1024 * 1024)):.2f} MB) exceeds maximum allowed size of {(max_size / (1024 * 1024)):.0f} MB",
            "file_size_mb": round(document.size / (1024 * 1024), 2),
            "max_size_mb": round(max_size / (1024 * 1024), 0)
        },
    )
```

**Impact:**
- Files over 25 MB are rejected with clear error message
- Error includes actual file size and limit
- HTTP 413 status code for proper error handling
- Logged for debugging

---

### 4. Frontend Client-Side Validation
**File:** `app/frontend/src/components/ui/gentle-file-upload.tsx`

**Changes:**

#### a) Added Constants and Imports (Lines 1-11)
```typescript
import { useToast } from "@/src/hooks/use-toast";

// Maximum file size: 25 MB (must match backend and nginx config)
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB in bytes
const LARGE_FILE_WARNING = 10 * 1024 * 1024; // Warn for files >10 MB
```

#### b) Added Validation Function (Lines 42-77)
```typescript
const validateAndHandleFiles = (newFiles: File[]) => {
  const validFiles: File[] = [];
  const rejectedFiles: { name: string; reason: string }[] = [];

  newFiles.forEach((file) => {
    if (file.size > MAX_FILE_SIZE) {
      rejectedFiles.push({
        name: file.name,
        reason: `exceeds ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
      });
    } else {
      validFiles.push(file);

      // Show warning for large files
      if (file.size > LARGE_FILE_WARNING) {
        toast({
          title: "Large file detected",
          description: `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB) may take longer to process.`,
          variant: "default",
        });
      }
    }
  });

  // Show errors for rejected files
  if (rejectedFiles.length > 0) {
    const errorMessage = rejectedFiles
      .map((f) => `• ${f.name}: ${f.reason}`)
      .join("\n");

    toast({
      title: `${rejectedFiles.length} file${rejectedFiles.length > 1 ? "s" : ""} rejected`,
      description: errorMessage,
      variant: "destructive",
    });
  }

  return validFiles;
};
```

#### c) Display File Size Limit in UI (Line 134)
```typescript
<p className="relative z-20 font-sans font-normal text-neutral-500 dark:text-neutral-500 text-sm mt-1">
  Maximum file size: {(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)} MB
</p>
```

**Impact:**
- ✅ Files are validated before upload (saves bandwidth & time)
- ✅ Users see clear error messages immediately if files are too large
- ✅ Large files (>10 MB) show a processing time warning
- ✅ Maximum file size is displayed in the UI (25 MB)
- ✅ Multiple rejected files are batched in a single error message

---

## User Experience Improvements

### Before Changes
- ❌ No visible size limit in UI
- ❌ Files rejected only after upload attempt
- ❌ Generic HTTP 413 error with no context
- ❌ No warning for large files
- ❌ 1 MB limit was very restrictive

### After Changes
- ✅ **25 MB limit** displayed prominently in UI
- ✅ **Instant validation** before upload starts
- ✅ **Clear error messages** with file size details
- ✅ **Warnings for large files** (>10 MB) about processing time
- ✅ **Better error formatting** on backend
- ✅ **25 MB limit** supports most business documents

---

## Testing Instructions

### 1. Test Client-Side Validation
```bash
# Create a test file larger than 25 MB
dd if=/dev/zero of=test_30mb.pdf bs=1M count=30

# Try uploading this file through the UI
# Expected: Immediate error message without upload
# Message: "1 file rejected: • test_30mb.pdf: exceeds 25 MB limit (30.00 MB)"
```

### 2. Test Large File Warning
```bash
# Create a test file between 10-25 MB
dd if=/dev/zero of=test_15mb.pdf bs=1M count=15

# Try uploading this file through the UI
# Expected: Warning toast about processing time
# Message: "Large file detected: test_15mb.pdf (15.00 MB) may take longer to process."
```

### 3. Test Backend Validation
```bash
# If client-side validation is bypassed, backend should catch it
curl -X POST \
  http://localhost:3000/vector-db-api/my-collection/insert_document/ \
  -F "document=@test_30mb.pdf"

# Expected: HTTP 413 with JSON error
# Response: {"error": "File size (30.00 MB) exceeds maximum allowed size of 25 MB", ...}
```

### 4. Test Normal Upload
```bash
# Create a test file under 10 MB
dd if=/dev/zero of=test_5mb.pdf bs=1M count=5

# Try uploading through the UI
# Expected: Successful upload with no warnings
```

### 5. Verify Limits Are Displayed
- Open the upload page
- Check for text: "Maximum file size: 25 MB"

---

## Deployment Steps

### Option 1: Docker Compose (Recommended)

```bash
# Rebuild and restart services
docker-compose down
docker-compose build
docker-compose up -d

# Check logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Option 2: Manual Restart

```bash
# If services are already running, restart them
docker-compose restart backend
docker-compose restart frontend
```

### Option 3: Individual Container Rebuild

```bash
# Rebuild only backend
docker-compose build backend
docker-compose up -d backend

# Rebuild only frontend
docker-compose build frontend
docker-compose up -d frontend
```

---

## Configuration Reference

All three layers must be configured consistently:

| Layer | Location | Setting | Value |
|-------|----------|---------|-------|
| **Nginx** | `app/frontend/nginx.conf` | `client_max_body_size` | `25M` |
| **Django** | `app/backend/api/settings.py` | `DATA_UPLOAD_MAX_MEMORY_SIZE` | `26214400` (25 MB) |
| **Frontend** | `app/frontend/src/components/ui/gentle-file-upload.tsx` | `MAX_FILE_SIZE` | `25 * 1024 * 1024` |

**To change the limit in the future:**
1. Update all three values to match
2. Rebuild and restart services
3. Test with files at the new limit

---

## Related Documentation

- **Investigation Report:** `DOCUMENT_UPLOAD_LIMITS.md`
- **Page Limit Info:** Unlimited pages (only constrained by file size)
- **Processing Timeout:** 20 minutes (configured in `docker-compose.yml`)

---

## Validation Checklist

After deployment, verify:

- [ ] Upload component shows "Maximum file size: 25 MB"
- [ ] Files >25 MB are rejected immediately with error message
- [ ] Files 10-25 MB show warning about processing time
- [ ] Files <10 MB upload without warnings
- [ ] Backend logs show file size in rejection messages
- [ ] HTTP 413 errors include file size details
- [ ] Multiple files are validated correctly
- [ ] Drag & drop validation works
- [ ] Click to browse validation works

---

## Future Enhancements (Optional)

1. **Progress Indicator:** Show upload progress for large files
2. **Page Count Display:** Show PDF page count before processing
3. **Batch Processing:** Queue very large documents for background processing
4. **Resumable Uploads:** Support pausing/resuming for very large files
5. **Compression Suggestions:** Offer to compress large PDFs
6. **Advanced Limits:** Different limits per user/role
7. **Analytics:** Track upload sizes and rejection rates

---

## Summary

✅ **Maximum file size increased:** 1 MB → 25 MB
✅ **Client-side validation:** Immediate feedback before upload
✅ **Clear error messages:** Users know exactly what went wrong
✅ **Large file warnings:** Users informed about processing time
✅ **UI displays limit:** No guessing required
✅ **Backend validation:** Safety net if client-side is bypassed
✅ **Consistent config:** All three layers (Nginx, Django, Frontend) aligned

**Practical Capacity:**
- Text-heavy PDFs: ~5,000-7,500 pages
- PDFs with images: ~250-750 pages
- Word documents: ~5,000-10,000 pages
- Mixed media documents: ~500-1,000 pages

All files are still subject to the 20-minute processing timeout.

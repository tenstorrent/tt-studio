# Document Upload Size and Page Limits

## Quick Answer

**Maximum File Size: 1 MB**
- Primary limitation: Nginx default configuration
- Applies to all file formats (PDF, DOCX, TXT, MD, HTML, etc.)

**Maximum Pages: UNLIMITED**
- All pages in uploaded documents are processed
- Only limited by the 1 MB file size constraint
- Processing timeout: 20 minutes

**Practical Capacity:**
- Text-heavy PDFs: ~200-300 pages within 1 MB
- PDFs with images: ~10-50 pages within 1 MB

---

## Current System Configuration

### 1. File Size Limits

#### Nginx (Primary Bottleneck) - **1 MB**
- **Location:** `app/frontend/nginx.conf`
- **Setting:** `client_max_body_size` (not configured, uses default)
- **Impact:** Files larger than 1 MB are rejected with HTTP 413 error before reaching the backend
- **Priority:** This is the most restrictive limit

#### Django Backend - **2.5 MB**
- **Location:** `app/backend/api/settings.py`
- **Setting:** `DATA_UPLOAD_MAX_MEMORY_SIZE` (not configured, uses default)
- **Impact:** Secondary limit, rarely reached due to Nginx restriction

#### Gunicorn Processing Timeout - **20 minutes**
- **Location:** `docker-compose.yml:23`
- **Setting:** `--timeout 1200`
- **Impact:** Adequate for processing large documents

### 2. Page Processing

#### PDF Page Extraction
```python
# File: vector_db_control/document_processor.py:41-57
for page in pdf_reader.pages:  # ALL pages processed
    documents.append(Document(
        page_content=page.extract_text(),
        metadata=metadata
    ))
```

**Behavior:**
- Every page in the PDF is extracted as text
- No maximum page count enforced
- Each page becomes a separate document before chunking

### 3. Text Chunking Configuration

**Settings:** (`vector_db_control/documents.py`)
```python
chunk_size: int = 1000      # Characters per chunk
chunk_overlap: int = 100    # Character overlap between chunks
```

**Processing Flow:**
1. PDF pages extracted → individual documents
2. Documents split into 1000-character chunks
3. 100-character overlap for context preservation
4. Each chunk gets embedded and stored in ChromaDB

**Example:** 100-page PDF with 2000 characters/page
- 100 page documents extracted
- ~200 chunks created (2000 ÷ 1000 × 100)
- 200 embeddings stored in vector database

### 4. Supported File Formats

| Format | Extensions | Page Support |
|--------|------------|--------------|
| PDF | `.pdf` | All pages |
| Word | `.docx`, `.doc` | All content |
| Text | `.txt` | All content |
| Markdown | `.md` | All content |
| HTML | `.html` | All content |
| Code | `.py`, `.js`, `.ts`, etc. | All content |

---

## Current Issues

### Issue 1: Restrictive 1 MB Default Limit
- **Problem:** Many business documents (especially PDFs with images) exceed 1 MB
- **Impact:** Users receive upload rejection with no prior warning
- **User Experience:** HTTP 413 error without clear explanation

### Issue 2: No Client-Side Validation
- **Location:** `app/frontend/src/components/ui/gentle-file-upload.tsx`
- **Problem:** Users don't see size limit warnings until upload fails
- **Impact:** Poor user experience with failed uploads

### Issue 3: No Page Count Feedback
- **Problem:** Users cannot see page count before uploading large PDFs
- **Impact:** Uncertainty about processing success for large documents

### Issue 4: Undocumented Limits
- **Problem:** No user-facing documentation of upload constraints
- **Impact:** Users learn limits through trial and error

---

## Increasing Upload Limits (Optional)

If you need to support larger files, follow these steps:

### Step 1: Update Nginx Configuration

**File:** `app/frontend/nginx.conf`

Add this line inside the `server` block:
```nginx
server {
    listen 80;
    server_name localhost;
    client_max_body_size 50M;  # Increase to 50 MB

    # ... rest of configuration
}
```

### Step 2: Update Django Settings

**File:** `app/backend/api/settings.py`

Add these settings:
```python
# File upload limits
DATA_UPLOAD_MAX_MEMORY_SIZE = 52428800  # 50 MB in bytes
FILE_UPLOAD_MAX_MEMORY_SIZE = 52428800  # 50 MB
```

### Step 3: Add Client-Side Validation

**File:** `app/frontend/src/components/ui/gentle-file-upload.tsx`

Add validation before upload:
```typescript
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// In file selection handler
if (file.size > MAX_FILE_SIZE) {
  toast({
    title: "File too large",
    description: `${file.name} exceeds the ${MAX_FILE_SIZE / (1024 * 1024)} MB limit`,
    variant: "destructive"
  });
  return;
}
```

### Step 4: Rebuild and Restart Services

```bash
# Rebuild Docker images
docker-compose build

# Restart services
docker-compose down
docker-compose up -d
```

---

## Verification and Testing

### Check Current Configuration

```bash
# Check Nginx limit
cat app/frontend/nginx.conf | grep client_max_body_size

# Check Django limit
grep DATA_UPLOAD_MAX_MEMORY_SIZE app/backend/api/settings.py

# Check Gunicorn timeout
grep timeout docker-compose.yml
```

### Test Upload Limits

1. **Test 1 MB limit:**
   - Upload a file slightly over 1 MB
   - Expected: HTTP 413 error

2. **Test multi-page PDF:**
   - Upload a 50-page PDF under 1 MB
   - Verify all pages are processed
   - Check ChromaDB for chunk count

3. **Test chunking:**
   - Upload a document
   - Verify chunks are ~1000 characters each
   - Check for 100-character overlap

### Monitor Processing

```bash
# Watch backend logs during upload
docker-compose logs -f backend

# Check ChromaDB collection after upload
# Verify number of chunks matches expected count
```

---

## Performance Considerations

### Memory Usage
- **Per-file:** Each uploaded file loads into memory
- **Chunking:** Minimal memory overhead (streaming approach)
- **Embeddings:** Generated chunk-by-chunk

### Processing Time Estimates
| Document Size | Page Count | Estimated Time |
|--------------|------------|----------------|
| < 1 MB | 10-50 pages | 30-60 seconds |
| 10 MB | 100-200 pages | 2-5 minutes |
| 50 MB | 500+ pages | 10-20 minutes |

*Note: Times vary based on document complexity and embedding model*

### Resource Limits
- **Workers:** 3 Gunicorn workers (configured)
- **Timeout:** 20 minutes per request
- **Concurrent uploads:** Limited by worker count

---

## Recommendations

### For Current System (1 MB Limit)
1. **Document the limit** in user-facing UI
2. **Add client-side validation** with clear error messages
3. **Show file size** before upload attempt
4. **Provide guidance** on optimizing PDF file sizes

### For Production Systems
1. **Increase limits** to 10-50 MB based on use case
2. **Add progress indicators** for large file uploads
3. **Implement page count display** for PDFs
4. **Consider streaming uploads** for very large files
5. **Add rate limiting** to prevent abuse
6. **Monitor memory usage** with larger limits

### For Large Document Processing
1. **Batch processing:** Queue large documents for background processing
2. **Page limits:** Consider adding optional page count limits (e.g., 1000 pages)
3. **Compression:** Encourage users to compress images in PDFs
4. **Chunked uploads:** Implement resumable uploads for files >50 MB

---

## Related Files

- **Nginx Config:** `app/frontend/nginx.conf:1-42`
- **Django Settings:** `app/backend/api/settings.py:1-186`
- **Document Processor:** `app/backend/vector_db_control/document_processor.py:41-57`
- **Chunking Config:** `app/backend/vector_db_control/documents.py:23-24`
- **Upload View:** `app/backend/vector_db_control/views.py:254-447`
- **Frontend Upload:** `app/frontend/src/components/ui/gentle-file-upload.tsx`

---

## Summary

**Current Limits:**
- ✅ Maximum file size: **1 MB** (Nginx default)
- ✅ Maximum pages: **Unlimited** (constrained by file size)
- ✅ Processing timeout: **20 minutes**
- ❌ No client-side validation
- ❌ No user-facing documentation

**To Support Larger Files:**
- Update Nginx `client_max_body_size`
- Update Django `DATA_UPLOAD_MAX_MEMORY_SIZE`
- Add client-side validation
- Test thoroughly with large files

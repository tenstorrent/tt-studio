# Document Upload Size Limits - Comprehensive Testing Guide

## Overview

This guide provides comprehensive test cases for the document upload size limits implementation, covering client-side validation, server-side enforcement, error handling, and integration with the RAG system.

**Configuration Under Test:**
- Maximum File Size: **25 MB**
- Large File Warning Threshold: **10 MB**
- Processing Timeout: **20 minutes**
- Unlimited page count (constrained by file size)

---

## Test Prerequisites

### 1. Environment Setup

**Verify Configuration:**
```bash
# Check Nginx config
cat app/frontend/nginx.conf | grep client_max_body_size
# Expected: client_max_body_size 25M;

# Check Django settings
grep -A 2 "File upload size limits" app/backend/api/settings.py
# Expected: DATA_UPLOAD_MAX_MEMORY_SIZE = 26214400

# Check frontend constant
grep "MAX_FILE_SIZE" app/frontend/src/components/ui/gentle-file-upload.tsx
# Expected: const MAX_FILE_SIZE = 25 * 1024 * 1024;
```

**Services Running:**
```bash
docker-compose ps
# Verify all services are up:
# - tt_studio_frontend (port 3000)
# - tt_studio_backend_api (port 8000)
# - tt_studio_chromadb (port 8111)
```

### 2. Test File Preparation

Create test files of various sizes:

```bash
# Navigate to test directory
mkdir -p test_files
cd test_files

# Small file (1 MB)
dd if=/dev/zero of=test_1mb.pdf bs=1M count=1

# Medium file (10 MB - at warning threshold)
dd if=/dev/zero of=test_10mb.pdf bs=1M count=10

# Large file (15 MB - between warning and limit)
dd if=/dev/zero of=test_15mb.pdf bs=1M count=15

# At limit (25 MB - should pass)
dd if=/dev/zero of=test_25mb.pdf bs=1M count=25

# Just over limit (26 MB - should fail)
dd if=/dev/zero of=test_26mb.pdf bs=1M count=26

# Way over limit (50 MB - should fail)
dd if=/dev/zero of=test_50mb.pdf bs=1M count=50

# Tiny file (100 KB)
dd if=/dev/zero of=test_100kb.pdf bs=1K count=100
```

**Create Real PDF with Content:**
```bash
# For RAG integration testing, create a real PDF
echo "Test Document Content
This is a test document for RAG integration.
The file size is 15 MB for testing large file handling.
" > test_content.txt

# Use a tool to create actual PDF (e.g., LibreOffice, pandoc, or online converter)
# Or use existing PDF and pad to desired size
```

---

## Test Suite 1: Client-Side Validation

### Test 1.1: Upload Within Limit (< 10 MB)
**Objective:** Verify files under 10 MB upload without warnings

**Steps:**
1. Open upload page at `http://localhost:3000`
2. Click upload area or drag `test_1mb.pdf`
3. Observe UI behavior

**Expected Results:**
- ✅ File appears in upload list immediately
- ✅ File size shown: "1.00 MB"
- ✅ No warning toast displayed
- ✅ No error messages
- ✅ Upload proceeds normally

**Console Output:**
```javascript
// No errors or warnings
```

---

### Test 1.2: Upload at Warning Threshold (10 MB)
**Objective:** Verify warning is shown for files ≥ 10 MB

**Steps:**
1. Navigate to upload page
2. Upload `test_10mb.pdf`
3. Check for warning toast

**Expected Results:**
- ✅ File appears in upload list
- ✅ File size shown: "10.00 MB"
- ⚠️ Toast notification appears:
  - Title: "Large file detected"
  - Message: "test_10mb.pdf (10.00 MB) may take longer to process."
  - Variant: Default (not destructive)
- ✅ Upload proceeds

**Visual Indicators:**
- [ ] Toast with info styling (not error)
- [ ] File shown in upload list
- [ ] Processing continues

---

### Test 1.3: Upload Between Warning and Limit (15 MB)
**Objective:** Verify warning shown but upload allowed

**Steps:**
1. Upload `test_15mb.pdf`
2. Observe warning and upload behavior

**Expected Results:**
- ✅ File appears in upload list
- ✅ File size shown: "15.00 MB"
- ⚠️ Warning toast displayed
- ✅ Upload allowed to proceed

---

### Test 1.4: Upload at Exact Limit (25 MB)
**Objective:** Verify 25 MB files are accepted

**Steps:**
1. Upload `test_25mb.pdf`
2. Verify it's accepted

**Expected Results:**
- ✅ File appears in upload list
- ✅ File size shown: "25.00 MB"
- ⚠️ Warning toast (file > 10 MB)
- ✅ Upload proceeds successfully

---

### Test 1.5: Upload Over Limit (26 MB) - Client Rejection
**Objective:** Verify client-side rejection for files > 25 MB

**Steps:**
1. Attempt to upload `test_26mb.pdf`
2. Observe immediate rejection

**Expected Results:**
- ❌ File does NOT appear in upload list
- ❌ Toast notification with error:
  - Title: "1 file rejected"
  - Message: "• test_26mb.pdf: exceeds 25 MB limit (26.00 MB)"
  - Variant: Destructive (red/error styling)
- ❌ No network request made (check Network tab)

**Console Output:**
```javascript
// Should see validation in console if logging enabled
// No API call should be made
```

**Visual Indicators:**
- [ ] Red/destructive toast
- [ ] File NOT in upload list
- [ ] No loading/progress indicators
- [ ] No API request in Network tab

---

### Test 1.6: Upload Way Over Limit (50 MB)
**Objective:** Verify rejection for very large files

**Steps:**
1. Attempt to upload `test_50mb.pdf`

**Expected Results:**
- ❌ Immediate rejection
- ❌ Error toast: "exceeds 25 MB limit (50.00 MB)"
- ❌ No upload attempt

---

### Test 1.7: Multiple Files - Mixed Sizes
**Objective:** Verify batch validation works correctly

**Steps:**
1. Select multiple files at once:
   - `test_1mb.pdf` (valid)
   - `test_15mb.pdf` (valid, warning)
   - `test_26mb.pdf` (invalid)
   - `test_50mb.pdf` (invalid)

**Expected Results:**
- ✅ Valid files (1 MB, 15 MB) appear in list
- ❌ Invalid files (26 MB, 50 MB) rejected
- ❌ Error toast: "2 files rejected"
  - "• test_26mb.pdf: exceeds 25 MB limit (26.00 MB)"
  - "• test_50mb.pdf: exceeds 25 MB limit (50.00 MB)"
- ⚠️ Warning toast for 15 MB file

---

### Test 1.8: Drag and Drop Over Limit
**Objective:** Verify drag-and-drop validation

**Steps:**
1. Drag `test_50mb.pdf` to upload area
2. Drop file

**Expected Results:**
- ❌ Same rejection behavior as click upload
- ❌ Error toast displayed
- ❌ No upload attempt

---

### Test 1.9: UI Limit Display
**Objective:** Verify limit is clearly displayed

**Steps:**
1. Navigate to upload page
2. Locate size limit text

**Expected Results:**
- ✅ Text visible: "Maximum file size: 25 MB"
- ✅ Text positioned below main instructions
- ✅ Readable font size and color
- ✅ Always visible (not hidden)

**Visual Check:**
- [ ] Text present and readable
- [ ] Consistent with actual limit
- [ ] Clear to users before attempting upload

---

## Test Suite 2: Backend Validation

### Test 2.1: Bypass Client Validation - Direct API Call
**Objective:** Verify backend enforces limit even if client validation bypassed

**Steps:**
```bash
# Create a collection first
curl -X POST http://localhost:8000/collections/ \
  -H "Content-Type: application/json" \
  -d '{"name": "test-collection"}'

# Try to upload oversized file directly to API
curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_50mb.pdf" \
  -v
```

**Expected Results:**
- ❌ HTTP Status: `413 REQUEST ENTITY TOO LARGE`
- ❌ Response body:
```json
{
  "error": "File size (50.00 MB) exceeds maximum allowed size of 25 MB",
  "file_size_mb": 50.0,
  "max_size_mb": 25
}
```

**Backend Logs:**
```
WARNING - File test_50mb.pdf rejected: size 52428800 bytes exceeds 26214400 bytes
```

---

### Test 2.2: Backend Accepts Valid Size
**Objective:** Verify backend accepts files under limit

**Steps:**
```bash
curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_15mb.pdf" \
  -v
```

**Expected Results:**
- ✅ HTTP Status: `200 OK` or `201 CREATED`
- ✅ Response indicates success
- ✅ File processed and chunked

---

### Test 2.3: Backend at Exact Limit
**Objective:** Verify 25 MB files accepted by backend

**Steps:**
```bash
curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_25mb.pdf" \
  -v
```

**Expected Results:**
- ✅ HTTP Status: `200 OK`
- ✅ File accepted and processed

---

### Test 2.4: Backend Just Over Limit
**Objective:** Verify backend rejects 26 MB file

**Steps:**
```bash
curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_26mb.pdf" \
  -v
```

**Expected Results:**
- ❌ HTTP Status: `413`
- ❌ Clear error message with actual sizes

---

## Test Suite 3: Nginx Layer

### Test 3.1: Nginx Config Verification
**Objective:** Verify Nginx configuration is correct

**Steps:**
```bash
# Check Nginx config in running container
docker-compose exec tt_studio_frontend cat /etc/nginx/conf.d/default.conf | grep client_max_body_size
```

**Expected Results:**
- ✅ Output: `client_max_body_size 25M;`

---

### Test 3.2: Nginx Rejects Oversized Request
**Objective:** Verify Nginx rejects before reaching backend

**Steps:**
```bash
# Upload very large file through frontend proxy
curl -X POST \
  http://localhost:3000/vector-db-api/test-collection/insert_document/ \
  -F "document=@test_files/test_50mb.pdf" \
  -v
```

**Expected Results:**
- ❌ HTTP Status: `413 Request Entity Too Large`
- ❌ Nginx error (before Django processes it)

---

## Test Suite 4: RAG Integration

### Test 4.1: Upload Valid Document and Query
**Objective:** Verify uploaded documents work with RAG system

**Steps:**
1. Create a real test PDF with content:
   ```
   Document: Employee Benefits Guide
   Content: Employees receive 15 vacation days per year.
   Health insurance costs $150 per month.
   ```
2. Upload the document (under 25 MB)
3. Wait for processing to complete
4. Query: "How many vacation days do employees get?"

**Expected Results:**
- ✅ Document uploads successfully
- ✅ Processing completes without errors
- ✅ Query returns: "15 vacation days per year"
- ✅ Source citation included
- ✅ High confidence level
- ✅ Purple background (normal response)

**Console Output:**
```javascript
RAG Confidence Metadata: {
  confidenceLevel: 'high',
  isAnswerable: true,
  filteredCount: 2+,
  rawCount: 5+
}
```

---

### Test 4.2: Upload Large PDF with Content (15 MB)
**Objective:** Verify large valid files work with RAG

**Steps:**
1. Create a 15 MB PDF with real content (many pages)
2. Upload to collection
3. Verify warning shown
4. Wait for processing (may take 2-5 minutes)
5. Query document content

**Expected Results:**
- ⚠️ Warning toast: "Large file detected"
- ✅ Upload completes
- ✅ Processing completes (check for timeouts)
- ✅ Chunks stored in ChromaDB
- ✅ Queries work correctly
- ✅ Citations reference the document

**Backend Logs:**
```
INFO - Insert document request for collection: test-collection
INFO - Processing document: large_15mb.pdf
INFO - Document chunked into X chunks
INFO - Inserted X documents into collection
```

---

### Test 4.3: Upload Multiple Documents Various Sizes
**Objective:** Verify multiple uploads with RAG

**Steps:**
1. Upload 3 documents to same collection:
   - Small doc (1 MB)
   - Medium doc (10 MB)
   - Large doc (20 MB)
2. Verify all process successfully
3. Query content from different documents

**Expected Results:**
- ✅ All three documents upload
- ⚠️ Warnings for 10 MB and 20 MB files
- ✅ All documents indexed
- ✅ Queries can retrieve from any document
- ✅ Citations show correct source files

---

### Test 4.4: Verify Chunking for Large Documents
**Objective:** Ensure large documents are chunked properly

**Steps:**
1. Upload a 20 MB PDF (e.g., 200 pages)
2. Check ChromaDB for chunk count

**Commands:**
```bash
# Check collection stats
curl http://localhost:8000/collections/test-collection/

# Or query ChromaDB directly
docker-compose exec tt_studio_chromadb curl http://localhost:8111/api/v1/collections
```

**Expected Results:**
- ✅ Document split into chunks (~1000 chars each)
- ✅ Reasonable chunk count (e.g., 200 pages → ~400-600 chunks)
- ✅ Chunks have proper metadata
- ✅ Each chunk < 1000 characters

---

## Test Suite 5: Error Handling

### Test 5.1: Network Interruption During Upload
**Objective:** Verify graceful handling of network errors

**Steps:**
1. Start uploading a 20 MB file
2. Interrupt network (disconnect WiFi or kill backend)
3. Observe error handling

**Expected Results:**
- ❌ Upload fails with network error
- ❌ Clear error message to user
- ✅ No partial data in ChromaDB
- ✅ User can retry upload

---

### Test 5.2: Backend Processing Timeout
**Objective:** Verify timeout handling for very large files

**Steps:**
1. Upload a 25 MB PDF with complex content
2. Monitor processing time

**Expected Results:**
- ✅ Processing completes within 20 minutes (timeout)
- ✅ If timeout: Clear error message
- ✅ Proper cleanup of temp files

**Backend Timeout Config:**
```yaml
# docker-compose.yml
command: >
  gunicorn api.wsgi:application
  --bind 0.0.0.0:8000
  --workers 3
  --timeout 1200  # 20 minutes
```

---

### Test 5.3: Disk Space Exhaustion
**Objective:** Verify handling when disk is full

**Steps:**
1. Fill disk space (in test environment)
2. Attempt upload

**Expected Results:**
- ❌ Upload fails with disk space error
- ❌ Clear error message
- ✅ No corruption of existing data

---

### Test 5.4: Invalid File Types at Large Size
**Objective:** Verify size limits apply to all file types

**Steps:**
```bash
# Create large executable (should be rejected by type AND size)
dd if=/dev/zero of=test_50mb.exe bs=1M count=50

# Try to upload
```

**Expected Results:**
- ❌ Rejected due to file type (not in accept list)
- ❌ OR rejected due to size if type check passes

---

## Test Suite 6: Edge Cases

### Test 6.1: Exactly at Limit (25.00 MB)
**Objective:** Verify boundary condition

**Steps:**
```bash
# Create file of exactly 26214400 bytes
dd if=/dev/zero of=test_exact.pdf bs=1 count=26214400
```

**Expected Results:**
- ✅ Should pass (26214400 bytes = 25 MB exactly)

---

### Test 6.2: One Byte Over Limit
**Objective:** Verify strict enforcement

**Steps:**
```bash
# Create file of 26214401 bytes (25 MB + 1 byte)
dd if=/dev/zero of=test_one_over.pdf bs=1 count=26214401
```

**Expected Results:**
- ❌ Should fail with rejection message

---

### Test 6.3: Empty File
**Objective:** Verify handling of 0-byte files

**Steps:**
```bash
touch test_empty.pdf
```

**Expected Results:**
- ✅ Client accepts (< 25 MB)
- ❌ Backend may reject due to invalid PDF format
- OR ✅ Processes but creates 0 chunks

---

### Test 6.4: Compressed vs Uncompressed PDFs
**Objective:** Verify size check uses actual file size

**Steps:**
1. Create 30 MB PDF with images
2. Compress to 20 MB
3. Upload compressed version

**Expected Results:**
- ✅ Compressed 20 MB version accepted
- ✅ Size check uses actual file size (20 MB)
- ✅ Content fully accessible after decompression

---

### Test 6.5: Unicode Filename with Size Validation
**Objective:** Verify size validation works with special characters

**Steps:**
```bash
# Create file with unicode name
cp test_15mb.pdf "тест_файл_15MB_文件.pdf"
# Upload this file
```

**Expected Results:**
- ⚠️ Warning for 15 MB file
- ✅ Upload succeeds
- ✅ Filename handled correctly

---

### Test 6.6: Concurrent Uploads
**Objective:** Verify multiple simultaneous uploads

**Steps:**
1. Open upload page in 2 browser tabs
2. Upload 20 MB file in tab 1
3. Immediately upload 15 MB file in tab 2

**Expected Results:**
- ✅ Both uploads process (may be sequential)
- ⚠️ Warnings for both files
- ✅ Both complete successfully
- ✅ No race conditions or corruption

---

### Test 6.7: Upload Same File Multiple Times
**Objective:** Verify idempotency

**Steps:**
1. Upload `test_15mb.pdf`
2. Wait for completion
3. Upload same file again

**Expected Results:**
- ⚠️ Warning both times
- ✅ Both uploads succeed
- ✅ Multiple chunks in ChromaDB (duplicates allowed)
- ✅ OR conflict detected and handled

---

## Test Suite 7: Performance

### Test 7.1: Upload Speed for Various Sizes
**Objective:** Measure upload performance

**Steps:**
```bash
# Time uploads
time curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_1mb.pdf"

time curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_10mb.pdf"

time curl -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_25mb.pdf"
```

**Expected Results:**
- ✅ 1 MB: < 5 seconds
- ✅ 10 MB: < 30 seconds
- ✅ 25 MB: < 2 minutes
- ✅ Linear scaling with file size

---

### Test 7.2: Processing Time for Large PDFs
**Objective:** Measure end-to-end processing

**Steps:**
1. Upload 25 MB PDF with 250 pages
2. Time from upload start to first query success

**Expected Results:**
- ✅ Upload: < 2 minutes
- ✅ Processing: < 5 minutes
- ✅ Total: < 10 minutes
- ✅ Under 20-minute timeout

---

### Test 7.3: Memory Usage During Large Upload
**Objective:** Verify no memory leaks

**Steps:**
```bash
# Monitor backend memory
docker stats tt_studio_backend_api

# Upload large file and watch memory
```

**Expected Results:**
- ✅ Memory increases during upload
- ✅ Memory released after processing
- ✅ No sustained memory leak
- ✅ Under container limits

---

## Test Suite 8: Cross-Browser Testing

### Test 8.1: Chrome/Chromium
**Steps:**
1. Open Chrome
2. Run Test Suite 1 (client-side validation)

**Expected Results:**
- ✅ All client-side tests pass
- ✅ Toasts display correctly
- ✅ File size displayed correctly

---

### Test 8.2: Firefox
**Steps:**
1. Open Firefox
2. Run Test Suite 1

**Expected Results:**
- ✅ Same behavior as Chrome
- ✅ File validation works
- ✅ Toasts render properly

---

### Test 8.3: Safari
**Steps:**
1. Open Safari (if available)
2. Run Test Suite 1

**Expected Results:**
- ✅ Validation works
- ✅ UI displays correctly

---

## Console Output Validation

### What to Look For in Browser Console (F12)

**Successful Upload (< 10 MB):**
```javascript
// No errors or warnings
// Network tab shows successful POST request
```

**Large File Warning (10-25 MB):**
```javascript
// Toast notification triggered
// Upload proceeds
// Network tab shows POST request
```

**Client Rejection (> 25 MB):**
```javascript
// Validation error logged (if logging enabled)
// NO network request in Network tab
// Toast with error displayed
```

### What to Look For in Backend Logs

**Successful Upload:**
```
INFO - Insert document request for collection: test-collection
INFO - Processing document: test_15mb.pdf (15728640 bytes)
INFO - Document chunked into 250 chunks
INFO - Inserted 250 documents into collection test-collection
```

**Size Rejection:**
```
WARNING - File test_50mb.pdf rejected: size 52428800 bytes exceeds 26214400 bytes
```

**Processing:**
```
INFO - Chunking document with chunk_size=1000, chunk_overlap=100
INFO - Created 250 chunks from document
```

---

## Troubleshooting

### Issue: Client validation not working

**Symptoms:**
- Files > 25 MB not rejected immediately
- No error toast displayed

**Checks:**
1. Verify `MAX_FILE_SIZE` constant in `gentle-file-upload.tsx`
2. Check `validateAndHandleFiles` function is called
3. Verify `useToast` hook imported and working
4. Clear browser cache (Ctrl+Shift+R)

**Fix:**
```bash
# Rebuild frontend
docker-compose build frontend
docker-compose up -d frontend
```

---

### Issue: Backend accepts oversized files

**Symptoms:**
- Files > 25 MB processed by backend
- No HTTP 413 error

**Checks:**
1. Verify Django settings:
```bash
grep DATA_UPLOAD_MAX_MEMORY_SIZE app/backend/api/settings.py
```

2. Verify backend validation in views.py:
```bash
grep -A 10 "Check file size" app/backend/vector_db_control/views.py
```

**Fix:**
```bash
# Rebuild backend
docker-compose build backend
docker-compose up -d backend
```

---

### Issue: Nginx still rejecting at 1 MB

**Symptoms:**
- HTTP 413 error for files > 1 MB
- Files 1-25 MB rejected

**Checks:**
```bash
# Check Nginx config in container
docker-compose exec frontend cat /etc/nginx/conf.d/default.conf | grep client_max_body_size

# Check Nginx config source
cat app/frontend/nginx.conf | grep client_max_body_size
```

**Fix:**
```bash
# Verify config file updated
# Rebuild with --no-cache
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

---

### Issue: Warnings not displayed

**Symptoms:**
- Files > 10 MB upload without warning
- No toast notification

**Checks:**
1. Verify `LARGE_FILE_WARNING` constant (10 MB)
2. Check toast hook works for errors
3. Browser console for errors

---

### Issue: RAG queries fail after upload

**Symptoms:**
- Upload succeeds
- Queries return no results or errors

**Checks:**
```bash
# Check ChromaDB
curl http://localhost:8111/api/v1/collections

# Check backend logs
docker-compose logs backend | grep -i "insert_document"

# Verify chunks created
docker-compose logs backend | grep -i "chunk"
```

**Possible Causes:**
- Document processing failed
- ChromaDB connection issue
- Invalid PDF format
- Timeout during processing

---

## Success Checklist

After running all tests, verify:

### Client-Side Validation
- [ ] Files < 10 MB upload without warnings
- [ ] Files 10-25 MB show warning toast
- [ ] Files > 25 MB rejected immediately
- [ ] Error toasts show correct file size
- [ ] Multiple files validated correctly
- [ ] Drag & drop validation works
- [ ] UI displays "Maximum file size: 25 MB"

### Backend Validation
- [ ] Backend accepts files ≤ 25 MB
- [ ] Backend rejects files > 25 MB with HTTP 413
- [ ] Error messages include file sizes
- [ ] Backend logs show size validation

### Nginx Configuration
- [ ] Nginx config shows 25M limit
- [ ] Nginx rejects very large files before backend

### RAG Integration
- [ ] Uploaded documents queryable
- [ ] Large files (15-25 MB) process successfully
- [ ] Chunks stored correctly in ChromaDB
- [ ] RAG confidence system works with uploaded docs
- [ ] Source citations reference uploaded files

### Error Handling
- [ ] Clear error messages for all rejection scenarios
- [ ] Network errors handled gracefully
- [ ] No data corruption on failures
- [ ] Temp files cleaned up

### Performance
- [ ] Uploads complete in reasonable time
- [ ] No memory leaks
- [ ] Processing completes within timeout
- [ ] Concurrent uploads work

### Cross-Browser
- [ ] Works in Chrome/Chromium
- [ ] Works in Firefox
- [ ] Works in Safari (if tested)

---

## Reporting Issues

If tests fail, include:

1. **Test case number** (e.g., Test 1.5)
2. **Expected vs actual behavior**
3. **File size** being tested
4. **Browser** and version
5. **Console logs** (browser F12)
6. **Backend logs:**
   ```bash
   docker-compose logs backend | tail -100
   ```
7. **Configuration verification:**
   ```bash
   # Nginx
   docker-compose exec frontend cat /etc/nginx/conf.d/default.conf | grep client_max_body_size

   # Django
   docker-compose exec backend cat /app/api/settings.py | grep -A 2 "File upload"
   ```
8. **Screenshots** of error toasts/UI issues

---

## Advanced Testing Scenarios

### Stress Testing

**Test concurrent large uploads:**
```bash
# Upload 5 files simultaneously
for i in {1..5}; do
  curl -X POST \
    http://localhost:8000/collections/test-collection/insert_document/ \
    -F "document=@test_files/test_20mb.pdf" &
done
wait
```

**Expected:**
- All uploads complete
- No crashes or timeouts
- All documents indexed

---

### Security Testing

**Test path traversal in filename:**
```bash
# Create file with malicious name
cp test_1mb.pdf "../../../etc/passwd.pdf"
# Upload and verify proper sanitization
```

**Expected:**
- Filename sanitized
- No path traversal
- File stored safely

---

## Automated Testing Script

```bash
#!/bin/bash
# automated_upload_tests.sh

set -e

echo "=== Document Upload Size Limits Test Suite ==="

# Test 1: Small file
echo "Test 1: Uploading 1 MB file..."
response=$(curl -s -w "%{http_code}" -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_1mb.pdf")
if [[ $response == *"200"* ]] || [[ $response == *"201"* ]]; then
  echo "✅ PASS: 1 MB file accepted"
else
  echo "❌ FAIL: 1 MB file rejected"
fi

# Test 2: At limit
echo "Test 2: Uploading 25 MB file..."
response=$(curl -s -w "%{http_code}" -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_25mb.pdf")
if [[ $response == *"200"* ]] || [[ $response == *"201"* ]]; then
  echo "✅ PASS: 25 MB file accepted"
else
  echo "❌ FAIL: 25 MB file rejected"
fi

# Test 3: Over limit
echo "Test 3: Uploading 50 MB file..."
response=$(curl -s -w "%{http_code}" -X POST \
  http://localhost:8000/collections/test-collection/insert_document/ \
  -F "document=@test_files/test_50mb.pdf")
if [[ $response == *"413"* ]]; then
  echo "✅ PASS: 50 MB file rejected with 413"
else
  echo "❌ FAIL: 50 MB file not rejected properly"
fi

echo "=== Test Suite Complete ==="
```

---

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Upload Limits Tests

on: [push, pull_request]

jobs:
  test-upload-limits:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Start services
        run: docker-compose up -d

      - name: Wait for services
        run: sleep 30

      - name: Create test files
        run: |
          mkdir test_files
          dd if=/dev/zero of=test_files/test_1mb.pdf bs=1M count=1
          dd if=/dev/zero of=test_files/test_25mb.pdf bs=1M count=25
          dd if=/dev/zero of=test_files/test_50mb.pdf bs=1M count=50

      - name: Run automated tests
        run: bash automated_upload_tests.sh

      - name: Check logs
        if: failure()
        run: docker-compose logs
```

---

## Summary

This comprehensive testing guide covers:
- ✅ **8 test suites** with 30+ test cases
- ✅ **Client-side, backend, and Nginx** validation layers
- ✅ **RAG integration** testing
- ✅ **Error handling** and edge cases
- ✅ **Performance** testing
- ✅ **Cross-browser** validation
- ✅ **Automated testing** scripts
- ✅ **Troubleshooting** guides

Follow this guide systematically to ensure the upload size limits work correctly across all layers and integrate properly with the RAG system.

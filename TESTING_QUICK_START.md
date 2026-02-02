# Upload Limits Testing - Quick Start

## Quick Summary

I've created comprehensive test cases for the document upload limits (25 MB max) with RAG integration testing.

---

## Test Files Created

1. **`DOCUMENT_UPLOAD_TESTING_GUIDE.md`** - Complete testing guide with 8 test suites and 30+ test cases
2. **`test_upload_limits.sh`** - Automated test script for backend validation
3. **`TESTING_QUICK_START.md`** - This file (quick reference)

---

## Run Automated Tests (5 minutes)

```bash
# Make script executable
chmod +x test_upload_limits.sh

# Run automated tests
./test_upload_limits.sh

# To clean up test files after:
./test_upload_limits.sh full
```

**What it tests:**
- ✅ Backend accepts files ≤ 25 MB
- ❌ Backend rejects files > 25 MB with HTTP 413
- ✅ Error messages include file sizes
- ✅ Files at exact limit (25 MB) accepted
- ✅ Configuration verification

---

## Manual Browser Testing (10 minutes)

### Test 1: Upload Small File
1. Open `http://localhost:3000`
2. Go to RAG/document upload page
3. Upload a file < 10 MB
4. **Expected:** No warnings, uploads successfully

### Test 2: Upload Large File (Warning)
1. Upload a file between 10-25 MB
2. **Expected:** ⚠️ Yellow warning toast: "Large file detected... may take longer to process"
3. File uploads successfully

### Test 3: Upload Oversized File (Rejection)
1. Upload a file > 25 MB
2. **Expected:** ❌ Red error toast: "1 file rejected: exceeds 25 MB limit"
3. File NOT added to upload list
4. No network request made (check Network tab)

### Test 4: Check UI Displays Limit
1. Look at upload component
2. **Expected:** See text "Maximum file size: 25 MB"

### Test 5: Multiple Files
1. Select 3 files: 1 MB, 15 MB, 50 MB
2. **Expected:**
   - 1 MB and 15 MB: accepted
   - 50 MB: rejected in error toast
   - Warning for 15 MB file

---

## RAG Integration Testing (15 minutes)

### Test 1: Upload and Query
```bash
# 1. Create a test PDF with content (use any tool)
echo "Employees receive 15 vacation days per year." > test.txt
# Convert to PDF using your preferred tool

# 2. Upload to RAG collection (< 25 MB)
# 3. Wait for processing
# 4. Query: "How many vacation days?"
# Expected: "15 vacation days per year" with citation
```

### Test 2: Large Document Processing
```bash
# 1. Upload a 15 MB PDF with actual content
# 2. Observe warning toast
# 3. Wait for processing (2-5 minutes)
# 4. Query the document
# Expected: Content searchable, queries work
```

---

## Test Coverage Summary

### ✅ Client-Side Validation
- Files < 10 MB → No warnings
- Files 10-25 MB → Warning toast
- Files > 25 MB → Immediate rejection
- Multiple files → Batch validation
- Drag & drop → Validated
- UI shows limit

### ✅ Backend Validation
- Accepts ≤ 25 MB
- Rejects > 25 MB with HTTP 413
- Clear error messages with sizes
- Backend logs file rejections

### ✅ Nginx Configuration
- `client_max_body_size 25M` set
- Rejects very large requests

### ✅ RAG Integration
- Uploaded docs queryable
- Large files process correctly
- Chunks stored in ChromaDB
- RAG guardrails work with uploads

### ✅ Error Handling
- Clear error messages
- File size displayed
- Toast notifications work
- No data corruption

---

## Quick Troubleshooting

### Frontend build error?
```bash
docker-compose build frontend
docker-compose up -d frontend
```

### Backend not rejecting large files?
```bash
docker-compose build backend
docker-compose up -d backend
```

### Nginx still at 1 MB?
```bash
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

### Check all configurations?
```bash
# Nginx
cat app/frontend/nginx.conf | grep client_max_body_size

# Django
grep DATA_UPLOAD_MAX_MEMORY_SIZE app/backend/api/settings.py

# Frontend
grep MAX_FILE_SIZE app/frontend/src/components/ui/gentle-file-upload.tsx
```

---

## What's Different from RAG Guardrails Testing?

**Similarities:**
- Structured test cases with expected outcomes
- Visual indicators to check
- Console output validation
- Backend log verification
- Troubleshooting guides

**Differences:**
- RAG testing: Focuses on **answer accuracy** and **refusal messages**
- Upload testing: Focuses on **file size validation** and **error handling**

**Both integrate:** Upload tests verify documents work with RAG after passing validation

---

## Full Test Documentation

For comprehensive testing (edge cases, performance, security):
- **Full Guide:** `DOCUMENT_UPLOAD_TESTING_GUIDE.md`
- **8 test suites, 30+ test cases**
- **Automated script included**
- **CI/CD integration examples**

---

## Next Steps

1. ✅ Run automated script: `./test_upload_limits.sh`
2. ✅ Test in browser (10 minutes)
3. ✅ Verify RAG integration (15 minutes)
4. ✅ Check all visual indicators work
5. ✅ Run RAG guardrails tests with uploaded docs

**Total Time:** ~30-40 minutes for complete validation

---

## Success Criteria

After testing, you should have verified:

- [ ] Files < 10 MB upload without warnings
- [ ] Files 10-25 MB show warning toast
- [ ] Files > 25 MB rejected immediately
- [ ] UI displays "Maximum file size: 25 MB"
- [ ] Error messages clear and informative
- [ ] Backend rejects with HTTP 413
- [ ] Uploaded documents queryable in RAG
- [ ] RAG guardrails work with uploaded docs
- [ ] Large files (15-25 MB) process successfully
- [ ] No memory leaks or crashes

---

## Bug Reporting

If tests fail, gather:
1. Test case that failed
2. Browser console logs (F12)
3. Backend logs: `docker-compose logs backend | tail -100`
4. Screenshot of error
5. File size being tested
6. Configuration verification output

Then report with all details!

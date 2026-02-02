# RAG Guardrails Testing Guide

## Test Document Created
**File**: `test_rag_document.pdf` (in project root)
**Content**: Acme Corporation Employee Benefits Guide

## Step-by-Step Testing Instructions

### Step 1: Upload the Test Document

1. Open your TT Studio chat interface
2. Create or select a RAG collection
3. Upload `test_rag_document.pdf` to the collection
4. Wait for the upload to complete

### Step 2: Test High Confidence Answers (Should PASS)

These questions ARE in the document - you should get:
- ✅ Normal purple background
- ✅ Answer with source citation
- ✅ High confidence

**Test Questions**:
```
1. "How many vacation days do employees receive per year?"
   Expected: "15 vacation days per year" with citation

2. "What is the employer match for 401(k)?"
   Expected: "50% match on first 6% of salary" with citation

3. "What is the monthly cost for individual health insurance?"
   Expected: "$150 per month" with citation

4. "How much is the annual training budget?"
   Expected: "$2,000 per employee annually" with citation

5. "What are the remote work core hours?"
   Expected: "10 AM - 3 PM local time" with citation
```

### Step 3: Test Refusal Messages (Should REFUSE)

These questions are NOT in the document - you should see:
- ⚠️ Amber/yellow background
- ⚠️ Warning triangle icon
- ⚠️ "Insufficient Document Context" header
- 🟡 Refusal message

**Test Questions**:
```
1. "What is quantum computing?"
   Expected: REFUSAL with amber styling

2. "What is the capital of France?"
   Expected: REFUSAL with amber styling

3. "Explain machine learning algorithms"
   Expected: REFUSAL with amber styling

4. "What are the company's stock options?"
   Expected: REFUSAL (not mentioned in document)

5. "How many sick days do employees get?"
   Expected: REFUSAL (not in document - only vacation days mentioned)
```

### Step 4: Test Edge Cases

```
1. "Hello" or "Hi"
   Expected: Normal greeting (bypasses RAG)

2. "What documents do you have?"
   Expected: Should describe the uploaded document

3. "Tell me about benefits"
   Expected: Should summarize from document with high confidence
```

## What to Look For

### Console Output (Browser DevTools F12)

Open Console and look for:
```javascript
// When making a query:
RAG Confidence Metadata: {
  confidenceLevel: 'high',      // or 'medium', 'low', 'insufficient'
  isAnswerable: true,           // or false for refusals
  filteredCount: 5,             // number of docs that passed threshold
  rawCount: 10                  // total docs retrieved
}

// When refusal detected:
"Detected refusal response in message"
```

### Visual Indicators

#### For Refusal Messages:
- [ ] Amber background (darker than normal)
- [ ] Amber border around message
- [ ] ⚠️ Warning triangle icon at top
- [ ] Text: "Insufficient Document Context"
- [ ] Refusal message text in lighter amber color

#### For Low Confidence (if you get one):
- [ ] Purple background with yellow border
- [ ] ℹ️ Info icon
- [ ] Text: "Low confidence - answer may be incomplete"

#### For Normal Answers:
- [ ] Standard purple background
- [ ] No warning indicators
- [ ] Source citation at bottom

## Backend Logs (Optional)

If you have access to backend logs, look for:
```
Query filtering: 5/10 results passed threshold 0.8, answerable=True, confidence=high
```

## Troubleshooting

### Issue: All questions are answered (no refusals)

**Possible causes**:
1. RAG_STRICT_MODE not enabled
2. Threshold too lenient

**Fix**: Check `.env` file:
```bash
RAG_STRICT_MODE=True
RAG_CONFIDENCE_THRESHOLD=0.8
RAG_MIN_DOCUMENTS=2
```

Then restart services:
```bash
docker-compose restart tt_studio_backend_api
docker-compose restart tt_studio_frontend
```

### Issue: All questions refused (too many refusals)

**Possible causes**:
1. Threshold too strict
2. Document not properly indexed

**Fix**:
1. Check document was uploaded successfully
2. Try more lenient threshold in `.env`:
```bash
RAG_CONFIDENCE_THRESHOLD=1.0
```

### Issue: Visual indicators not showing

**Check**:
1. Frontend restarted after code changes
2. Browser cache cleared (Ctrl+Shift+R / Cmd+Shift+R)
3. Console shows confidence metadata
4. Message has `isRefusal: true` or `confidenceLevel: 'low'`

## Expected Results Summary

| Query Type | Background | Icon | Confidence | Citation |
|------------|-----------|------|------------|----------|
| In Document | Purple | None | High | Yes |
| Not in Doc | Amber | ⚠️ | Insufficient | No |
| Low Match | Purple + Yellow Border | ℹ️ | Low | Yes |
| Greeting | Green | None | N/A | No |

## Advanced Testing

### Test Confidence Levels

To test medium/low confidence, try:
1. Questions that partially match document content
2. Questions that require multiple documents
3. Questions with ambiguous phrasing

### Test Configuration Changes

Try different thresholds in `.env`:

**Very Strict** (more refusals):
```bash
RAG_CONFIDENCE_THRESHOLD=0.5
RAG_MIN_DOCUMENTS=3
```

**Very Lenient** (fewer refusals):
```bash
RAG_CONFIDENCE_THRESHOLD=1.2
RAG_MIN_DOCUMENTS=1
```

### Multiple Documents

1. Upload multiple PDFs to same collection
2. Ask questions that span multiple docs
3. Check if citations include multiple sources

## Success Checklist

After testing, you should have verified:

- [ ] Questions IN document scope → Answered with citations
- [ ] Questions OUT OF document scope → Refused with amber styling
- [ ] Refusal messages show warning triangle icon
- [ ] Console shows confidence metadata
- [ ] Backend logs show filtering information
- [ ] Visual styling distinct for refusals
- [ ] Source citations present in valid answers
- [ ] Greetings work normally (bypass RAG)

## Report Issues

If something doesn't work as expected:

1. **Check Console** for errors or missing metadata
2. **Check Backend Logs** for filtering information
3. **Verify Configuration** in `.env` file
4. **Clear Browser Cache** and reload
5. **Restart Services** if needed

Include in bug report:
- Query text
- Expected behavior
- Actual behavior
- Console logs (especially RAG Confidence Metadata)
- Configuration values (RAG_CONFIDENCE_THRESHOLD, etc.)

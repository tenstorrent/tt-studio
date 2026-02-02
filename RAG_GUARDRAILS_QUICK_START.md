# RAG Guardrails - Quick Start Guide

## What This Does

Prevents the RAG system from making up answers when information isn't in uploaded documents. When the system can't find relevant information, it will explicitly say "I cannot answer this based on the provided documents" instead of guessing.

## Configuration (1 Minute Setup)

### Option 1: Use Defaults (Recommended)
No configuration needed! The system uses sensible defaults:
- Strict mode: **Enabled**
- Confidence threshold: **0.8** (moderate)
- Minimum documents: **2**

### Option 2: Custom Configuration
Add to your environment variables or `.env` file:

```bash
# Enable/disable strict filtering
RAG_STRICT_MODE=True

# How strict should matching be? (0.0 = very strict, 2.0 = very lenient)
RAG_CONFIDENCE_THRESHOLD=0.8

# Minimum number of relevant documents required
RAG_MIN_DOCUMENTS=2

# Enable response validation (not yet integrated with streaming)
RAG_VALIDATION_ENABLED=True
```

#### Threshold Presets
- **Strict** (0.5): Very high confidence required, more refusals
- **Moderate** (0.8): Balanced - **recommended default**
- **Lenient** (1.2): Accept lower confidence matches, fewer refusals

## What Changed

### Backend
1. **Query Filtering**: Automatically filters low-confidence document matches
2. **Confidence Scores**: Each query now returns confidence metadata
3. **Validation Module**: New service for validating responses (ready for future integration)

### Frontend
1. **Smart Prompts**: Instructions vary based on confidence level
2. **Visual Indicators**:
   - 🟡 Amber/yellow styling for refusal messages
   - ⚠️ Warning icon for "insufficient context"
   - ℹ️ Info icon for low confidence answers
3. **Clear Boundaries**: Document context clearly marked in prompts

## How It Works

```
User Query
    ↓
1. Retrieval Layer: Find similar documents
    ↓
2. Filter by confidence threshold (0.8)
    ↓
3. Check minimum document count (2)
    ↓
4. Generate confidence-aware prompt
    ↓
5. LLM responds with strict instructions
    ↓
6. Frontend detects refusals and styles accordingly
    ↓
User sees clear message
```

## Visual Examples

### Refusal Message (No Relevant Docs)
```
┌─────────────────────────────────────────────────┐
│ ⚠️ Insufficient Document Context                │
│                                                  │
│ I cannot answer this question based on the      │
│ provided documents. The available documents     │
│ don't contain information relevant to your      │
│ query.                                          │
│                                                  │
│ Please consider:                                │
│ • Uploading documents that cover this topic    │
│ • Rephrasing your question                     │
│ • Asking about topics in your uploaded docs    │
└─────────────────────────────────────────────────┘
   Amber background with warning styling
```

### Low Confidence Answer
```
┌─────────────────────────────────────────────────┐
│ ℹ️ Low confidence - answer may be incomplete    │
│                                                  │
│ Based on the documents, the vacation policy     │
│ mentions 15 days per year. However, the         │
│ documents don't cover other details like        │
│ accrual or carry-over.                          │
│                                                  │
│ Source: employee_handbook.pdf                   │
└─────────────────────────────────────────────────┘
   Purple background with yellow border
```

### High Confidence Answer
```
┌─────────────────────────────────────────────────┐
│ The company provides 15 vacation days per year  │
│ for full-time employees. Days accrue monthly    │
│ and can be carried over up to 5 days.          │
│                                                  │
│ Source: employee_handbook.pdf                   │
└─────────────────────────────────────────────────┘
   Standard purple background
```

## Testing Your Setup

### Test 1: Refusal (Out of Scope)
1. Upload a document about cooking recipes
2. Ask: "What is quantum computing?"
3. ✅ **Expected**: Refusal message with amber styling

### Test 2: Successful Answer (In Scope)
1. Upload a document about company policies
2. Ask: "What are the vacation days?"
3. ✅ **Expected**: Answer with source citation

### Test 3: Edge Case (Greeting)
1. Say: "Hello"
2. ✅ **Expected**: Normal greeting (bypasses RAG)

## Verification Checklist

After deployment, verify:

- [ ] Backend returns `confidence_level` in query responses
- [ ] Frontend console shows "RAG Confidence Metadata"
- [ ] Refusal messages have amber/yellow styling
- [ ] Low confidence messages show info icon
- [ ] Source citations appear in answers
- [ ] Out-of-scope queries trigger refusals

## Troubleshooting

### Issue: All queries refused (too many refusals)
**Solution**: Increase threshold or decrease min_documents
```bash
RAG_CONFIDENCE_THRESHOLD=1.0  # More lenient
RAG_MIN_DOCUMENTS=1           # Lower requirement
```

### Issue: System still making up answers (not enough refusals)
**Solution**: Decrease threshold or increase min_documents
```bash
RAG_CONFIDENCE_THRESHOLD=0.5  # More strict
RAG_MIN_DOCUMENTS=3           # Higher requirement
```

### Issue: Not seeing confidence indicators in UI
**Check**:
1. Browser console for "RAG Confidence Metadata"
2. Backend logs for "Query filtering:" messages
3. Verify `RAG_STRICT_MODE=True` is set

### Issue: Queries very slow
**Check**: Response validation might be enabled without integration
```bash
RAG_VALIDATION_ENABLED=False  # Disable for now
```

## Monitoring

### Backend Logs
Look for these messages:
```
Query filtering: 5/10 results passed threshold 0.8, answerable=True, confidence=high
```

### Frontend Console
Look for:
```javascript
RAG Confidence Metadata: {
  confidenceLevel: 'high',
  isAnswerable: true,
  filteredCount: 5,
  rawCount: 10
}
```

### Metrics to Track
- **Refusal Rate**: % of queries refused
- **Confidence Distribution**: high/medium/low breakdown
- **Average Retrieved Documents**: Documents passing threshold

## Advanced: Fine-Tuning

### For Technical Documentation
```bash
RAG_CONFIDENCE_THRESHOLD=0.6  # Stricter matching
RAG_MIN_DOCUMENTS=3           # Require more evidence
```

### For General Q&A
```bash
RAG_CONFIDENCE_THRESHOLD=0.9  # More lenient
RAG_MIN_DOCUMENTS=1           # Single good match OK
```

### For Compliance/Legal
```bash
RAG_CONFIDENCE_THRESHOLD=0.4  # Very strict
RAG_MIN_DOCUMENTS=2           # Multiple sources required
```

## API Response Format

### Query Response (with confidence metadata)
```json
{
  "documents": [["doc1", "doc2"]],
  "metadatas": [[{...}, {...}]],
  "distances": [[0.3, 0.5]],
  "ids": [["id1", "id2"]],
  "is_answerable": true,
  "confidence_level": "high",
  "filtered_count": 2,
  "raw_count": 10,
  "threshold_used": 0.8,
  "min_documents_required": 2
}
```

## Support

### Questions?
- Check main implementation doc: `RAG_GUARDRAILS_IMPLEMENTATION.md`
- Review backend settings: `/app/backend/api/settings.py`
- Check frontend types: `/app/frontend/src/components/chatui/types.ts`

### Found a Bug?
Include in report:
1. Query text
2. Confidence metadata from console
3. Expected vs actual behavior
4. Configuration settings used

## Summary

**Default behavior (no config needed)**:
- ✅ Filters low-confidence matches (threshold: 0.8)
- ✅ Requires 2+ relevant documents
- ✅ Refuses when criteria not met
- ✅ Visual indicators in UI
- ✅ Source citations required

**Most common config change**:
```bash
# Make it more/less strict
RAG_CONFIDENCE_THRESHOLD=0.5  # Stricter
RAG_CONFIDENCE_THRESHOLD=1.0  # More lenient
```

That's it! The system works out of the box with sensible defaults. Only configure if you need different strictness levels for your use case.

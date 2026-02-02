#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

# Automated test script for document upload size limits
# Tests client-side validation, backend validation, and Nginx configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNED=0

# Configuration
BACKEND_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:3000"
TEST_COLLECTION="test-upload-limits-collection"
TEST_DIR="test_upload_files"

echo -e "${BLUE}==================================================================${NC}"
echo -e "${BLUE}    Document Upload Size Limits - Automated Test Suite${NC}"
echo -e "${BLUE}==================================================================${NC}"
echo ""

# Function to print test result
pass() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((FAILED++))
}

warn() {
    echo -e "${YELLOW}⚠️  WARN:${NC} $1"
    ((WARNED++))
}

info() {
    echo -e "${BLUE}ℹ️  INFO:${NC} $1"
}

# Check if services are running
check_services() {
    echo ""
    echo "=== Checking Services ==="

    if curl -s "$BACKEND_URL" > /dev/null 2>&1; then
        pass "Backend service is running"
    else
        fail "Backend service is not accessible at $BACKEND_URL"
        echo "Please start services with: docker-compose up -d"
        exit 1
    fi

    if curl -s "$FRONTEND_URL" > /dev/null 2>&1; then
        pass "Frontend service is running"
    else
        warn "Frontend service is not accessible at $FRONTEND_URL"
    fi
}

# Verify configuration
verify_config() {
    echo ""
    echo "=== Verifying Configuration ==="

    # Check Nginx config (if accessible)
    if docker-compose exec -T frontend cat /etc/nginx/conf.d/default.conf 2>/dev/null | grep -q "client_max_body_size 25M"; then
        pass "Nginx configured with 25M limit"
    else
        warn "Could not verify Nginx configuration (may need sudo/docker access)"
    fi

    # Check Django settings
    if grep -q "DATA_UPLOAD_MAX_MEMORY_SIZE = 26214400" app/backend/api/settings.py 2>/dev/null; then
        pass "Django configured with 25MB limit"
    else
        fail "Django settings not configured correctly"
    fi

    # Check frontend constant
    if grep -q "MAX_FILE_SIZE = 25 \* 1024 \* 1024" app/frontend/src/components/ui/gentle-file-upload.tsx 2>/dev/null; then
        pass "Frontend validation configured with 25MB limit"
    else
        warn "Could not verify frontend configuration"
    fi
}

# Create test files
create_test_files() {
    echo ""
    echo "=== Creating Test Files ==="

    mkdir -p "$TEST_DIR"

    # Small file (1 MB)
    if [ ! -f "$TEST_DIR/test_1mb.pdf" ]; then
        info "Creating 1 MB test file..."
        dd if=/dev/zero of="$TEST_DIR/test_1mb.pdf" bs=1M count=1 2>/dev/null
    fi

    # Medium file (10 MB)
    if [ ! -f "$TEST_DIR/test_10mb.pdf" ]; then
        info "Creating 10 MB test file..."
        dd if=/dev/zero of="$TEST_DIR/test_10mb.pdf" bs=1M count=10 2>/dev/null
    fi

    # Large valid file (24 MB - safely under limit)
    if [ ! -f "$TEST_DIR/test_24mb.pdf" ]; then
        info "Creating 24 MB test file..."
        dd if=/dev/zero of="$TEST_DIR/test_24mb.pdf" bs=1M count=24 2>/dev/null
    fi

    # Exactly at limit (25 MB = 26214400 bytes)
    if [ ! -f "$TEST_DIR/test_25mb_exact.pdf" ]; then
        info "Creating exactly 25 MB test file..."
        dd if=/dev/zero of="$TEST_DIR/test_25mb_exact.pdf" bs=1 count=26214400 2>/dev/null
    fi

    # Just over limit (26 MB)
    if [ ! -f "$TEST_DIR/test_26mb.pdf" ]; then
        info "Creating 26 MB test file..."
        dd if=/dev/zero of="$TEST_DIR/test_26mb.pdf" bs=1M count=26 2>/dev/null
    fi

    # Way over limit (50 MB)
    if [ ! -f "$TEST_DIR/test_50mb.pdf" ]; then
        info "Creating 50 MB test file..."
        dd if=/dev/zero of="$TEST_DIR/test_50mb.pdf" bs=1M count=50 2>/dev/null
    fi

    pass "Test files created in $TEST_DIR"
}

# Create test collection
create_collection() {
    echo ""
    echo "=== Creating Test Collection ==="

    # Delete existing collection if it exists
    curl -s -X DELETE "$BACKEND_URL/collections/$TEST_COLLECTION/" > /dev/null 2>&1 || true

    # Create new collection
    response=$(curl -s -X POST "$BACKEND_URL/collections/" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$TEST_COLLECTION\"}" \
        -w "%{http_code}")

    if [[ $response == *"201"* ]] || [[ $response == *"200"* ]]; then
        pass "Test collection created: $TEST_COLLECTION"
        return 0
    else
        fail "Failed to create test collection"
        return 1
    fi
}

# Test backend accepts small files
test_small_file() {
    echo ""
    echo "=== Test 1: Upload 1 MB file (should succeed) ==="

    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_1mb.pdf")

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        pass "1 MB file accepted (HTTP $http_code)"
    else
        fail "1 MB file rejected with HTTP $http_code"
    fi
}

# Test backend accepts medium files with warning threshold
test_medium_file() {
    echo ""
    echo "=== Test 2: Upload 10 MB file (should succeed with warning) ==="

    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_10mb.pdf")

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        pass "10 MB file accepted (HTTP $http_code)"
        info "Client should show warning toast for files > 10 MB"
    else
        fail "10 MB file rejected with HTTP $http_code"
    fi
}

# Test backend accepts files at limit
test_at_limit() {
    echo ""
    echo "=== Test 3: Upload 24 MB file (should succeed) ==="

    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_24mb.pdf")

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        pass "24 MB file accepted (HTTP $http_code)"
    else
        fail "24 MB file rejected with HTTP $http_code"
    fi
}

# Test exact limit
test_exact_limit() {
    echo ""
    echo "=== Test 4: Upload exactly 25 MB (should succeed) ==="

    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_25mb_exact.pdf")

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        pass "Exactly 25 MB file accepted (HTTP $http_code)"
    else
        fail "Exactly 25 MB file rejected with HTTP $http_code"
    fi
}

# Test backend rejects over-limit files
test_over_limit() {
    echo ""
    echo "=== Test 5: Upload 26 MB file (should fail) ==="

    response=$(curl -s -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_26mb.pdf" \
        -w "\n%{http_code}")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "413" ]; then
        pass "26 MB file rejected with HTTP 413"

        # Check if error message is informative
        if echo "$body" | grep -q "exceeds maximum allowed size"; then
            pass "Error message includes size information"
        else
            warn "Error message could be more informative"
        fi
    else
        fail "26 MB file not rejected properly (got HTTP $http_code)"
        echo "Response: $body"
    fi
}

# Test way over limit
test_way_over_limit() {
    echo ""
    echo "=== Test 6: Upload 50 MB file (should fail) ==="

    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_50mb.pdf")

    if [ "$http_code" = "413" ]; then
        pass "50 MB file rejected with HTTP 413"
    else
        fail "50 MB file not rejected properly (got HTTP $http_code)"
    fi
}

# Test error response format
test_error_format() {
    echo ""
    echo "=== Test 7: Verify error response format ==="

    response=$(curl -s -X POST \
        "$BACKEND_URL/collections/$TEST_COLLECTION/insert_document/" \
        -F "document=@$TEST_DIR/test_50mb.pdf")

    if echo "$response" | grep -q '"error"'; then
        pass "Error response includes 'error' field"
    else
        warn "Error response format could be improved"
    fi

    if echo "$response" | grep -q '"file_size_mb"'; then
        pass "Error response includes file size information"
    else
        warn "Error response missing file size details"
    fi
}

# Test file with valid content (RAG integration)
test_rag_integration() {
    echo ""
    echo "=== Test 8: RAG Integration (optional) ==="

    # Create a small PDF with actual content for RAG testing
    if command -v pdflatex &> /dev/null; then
        info "Creating test PDF with content..."
        # This would require pdflatex; skip if not available
        warn "Skipping RAG content test (requires pdflatex)"
    else
        info "RAG integration test requires manual verification"
        info "See DOCUMENT_UPLOAD_TESTING_GUIDE.md Test Suite 4"
    fi
}

# Cleanup
cleanup() {
    echo ""
    echo "=== Cleanup ==="

    info "Deleting test collection..."
    curl -s -X DELETE "$BACKEND_URL/collections/$TEST_COLLECTION/" > /dev/null 2>&1 || true

    if [ "$1" = "full" ]; then
        info "Deleting test files..."
        rm -rf "$TEST_DIR"
    else
        info "Test files kept in $TEST_DIR (use 'full' argument to delete)"
    fi
}

# Main test execution
main() {
    check_services
    verify_config
    create_test_files

    if create_collection; then
        test_small_file
        test_medium_file
        test_at_limit
        test_exact_limit
        test_over_limit
        test_way_over_limit
        test_error_format
        test_rag_integration
    fi

    cleanup "$1"

    # Print summary
    echo ""
    echo -e "${BLUE}==================================================================${NC}"
    echo -e "${BLUE}                        Test Summary${NC}"
    echo -e "${BLUE}==================================================================${NC}"
    echo -e "${GREEN}Passed: $PASSED${NC}"
    echo -e "${RED}Failed: $FAILED${NC}"
    echo -e "${YELLOW}Warnings: $WARNED${NC}"
    echo ""

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed!${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Test client-side validation in browser"
        echo "2. Verify upload UI shows 'Maximum file size: 25 MB'"
        echo "3. Test drag & drop with various file sizes"
        echo "4. Run RAG integration tests (see DOCUMENT_UPLOAD_TESTING_GUIDE.md)"
        exit 0
    else
        echo -e "${RED}❌ Some tests failed. Please review the output above.${NC}"
        echo ""
        echo "Troubleshooting:"
        echo "1. Verify services are running: docker-compose ps"
        echo "2. Check backend logs: docker-compose logs backend"
        echo "3. Verify configuration files were updated"
        echo "4. Rebuild services: docker-compose build && docker-compose up -d"
        exit 1
    fi
}

# Run main function
main "$@"

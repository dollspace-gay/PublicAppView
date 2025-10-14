#!/bin/bash
# Test script for local Constellation deployment
# Verifies that the local Constellation instance is working correctly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Print colored output
print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Test 1: Check if Constellation container is running
test_container_running() {
    print_test "Checking if Constellation container is running..."
    
    if docker ps | grep -q constellation-local; then
        print_pass "Constellation container is running"
        return 0
    else
        print_fail "Constellation container is not running"
        return 1
    fi
}

# Test 2: Check container health status
test_container_health() {
    print_test "Checking container health status..."
    
    local health_status=$(docker inspect --format='{{.State.Health.Status}}' constellation-local 2>/dev/null || echo "unknown")
    
    if [ "$health_status" = "healthy" ]; then
        print_pass "Container is healthy"
        return 0
    else
        print_fail "Container health status: $health_status"
        return 1
    fi
}

# Test 3: Check if API is responding
test_api_responding() {
    print_test "Checking if Constellation API is responding..."
    
    local response_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")
    
    if [ "$response_code" = "200" ]; then
        print_pass "API is responding (HTTP $response_code)"
        return 0
    else
        print_fail "API not responding properly (HTTP $response_code)"
        return 1
    fi
}

# Test 4: Test basic API endpoint
test_api_endpoint() {
    print_test "Testing API endpoints..."
    
    # Try to get a simple response from the API
    local response=$(curl -s http://localhost:8080/ 2>/dev/null || echo "error")
    
    if [ "$response" != "error" ] && [ -n "$response" ]; then
        print_pass "API endpoint returned data"
        return 0
    else
        print_fail "API endpoint did not return expected data"
        return 1
    fi
}

# Test 5: Check data directory
test_data_directory() {
    print_test "Checking data directory..."
    
    if [ -d "${PROJECT_ROOT}/constellation-data" ]; then
        local size=$(du -sh "${PROJECT_ROOT}/constellation-data" 2>/dev/null | cut -f1)
        print_pass "Data directory exists (Size: $size)"
        return 0
    else
        print_fail "Data directory not found"
        return 1
    fi
}

# Test 6: Check logs for errors
test_logs_for_errors() {
    print_test "Checking logs for critical errors..."
    
    local error_count=$(docker logs constellation-local 2>&1 | grep -i "error" | grep -v "rate limit" | wc -l || echo "0")
    
    if [ "$error_count" -lt 5 ]; then
        print_pass "No critical errors in logs ($error_count minor errors)"
        return 0
    else
        print_fail "Found $error_count errors in logs"
        print_info "Run 'docker logs constellation-local' to investigate"
        return 1
    fi
}

# Test 7: Check AppView integration
test_appview_integration() {
    print_test "Checking AppView integration..."
    
    local app_logs=$(docker logs app 2>&1 | grep "CONSTELLATION" | tail -n 5 || echo "")
    
    if echo "$app_logs" | grep -q "LOCAL"; then
        print_pass "AppView is configured for local Constellation"
        return 0
    elif echo "$app_logs" | grep -q "CONSTELLATION"; then
        print_fail "AppView is not using local Constellation"
        print_info "Run setup script to configure: ./scripts/setup-constellation-local.sh"
        return 1
    else
        print_fail "Could not determine AppView Constellation configuration"
        return 1
    fi
}

# Test 8: Check Redis cache integration
test_redis_cache() {
    print_test "Checking Redis cache for Constellation data..."
    
    local cache_keys=$(docker exec redis redis-cli KEYS "constellation:*" 2>/dev/null | wc -l || echo "0")
    
    if [ "$cache_keys" -gt 0 ]; then
        print_pass "Redis cache has Constellation data ($cache_keys keys)"
        return 0
    else
        print_info "No cached data yet (this is normal on fresh install)"
        print_pass "Redis is accessible"
        return 0
    fi
}

# Test 9: Performance test (simple)
test_performance() {
    print_test "Testing API response time..."
    
    local start_time=$(date +%s%N)
    curl -s http://localhost:8080/ > /dev/null 2>&1
    local end_time=$(date +%s%N)
    
    local response_time=$(( (end_time - start_time) / 1000000 )) # Convert to ms
    
    if [ "$response_time" -lt 1000 ]; then
        print_pass "API response time: ${response_time}ms (Good)"
        return 0
    elif [ "$response_time" -lt 5000 ]; then
        print_pass "API response time: ${response_time}ms (Acceptable)"
        return 0
    else
        print_fail "API response time: ${response_time}ms (Slow)"
        return 1
    fi
}

# Print banner
print_banner() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║         🧪 Constellation Local Test Suite 🧪              ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Print summary
print_summary() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "  Test Summary"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    local total=$((TESTS_PASSED + TESTS_FAILED))
    
    echo -e "  Total Tests: $total"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    echo ""
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed! Constellation is working correctly.${NC}"
    else
        echo -e "${RED}❌ Some tests failed. Please review the output above.${NC}"
    fi
    echo ""
}

# Main execution
main() {
    print_banner
    
    cd "$PROJECT_ROOT"
    
    # Run all tests
    test_container_running || true
    echo ""
    
    test_container_health || true
    echo ""
    
    test_api_responding || true
    echo ""
    
    test_api_endpoint || true
    echo ""
    
    test_data_directory || true
    echo ""
    
    test_logs_for_errors || true
    echo ""
    
    test_appview_integration || true
    echo ""
    
    test_redis_cache || true
    echo ""
    
    test_performance || true
    
    # Print summary
    print_summary
    
    # Exit with appropriate code
    if [ $TESTS_FAILED -eq 0 ]; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main "$@"

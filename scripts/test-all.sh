#!/bin/bash

# Run all API endpoint tests

source "$(dirname "$0")/config.sh"

echo "========================================"
echo "Running All API Endpoint Tests"
echo "========================================"
echo ""
echo "Instance: $BASE_URL"
echo ""

# Track results
total_tests=0
passed_tests=0
failed_tests=0

run_test_script() {
    local script=$1
    local script_name=$(basename "$script")
    
    echo ""
    echo "========================================"
    echo "Running: $script_name"
    echo "========================================"
    
    bash "$script"
    exit_code=$?
    
    total_tests=$((total_tests + 1))
    if [ $exit_code -eq 0 ]; then
        passed_tests=$((passed_tests + 1))
    else
        failed_tests=$((failed_tests + 1))
    fi
}

# Run all test scripts
run_test_script "$(dirname "$0")/test-health.sh"
run_test_script "$(dirname "$0")/test-system.sh"
run_test_script "$(dirname "$0")/test-auth.sh"
run_test_script "$(dirname "$0")/test-feed.sh"
run_test_script "$(dirname "$0")/test-actor.sh"
run_test_script "$(dirname "$0")/test-graph.sh"
run_test_script "$(dirname "$0")/test-notifications.sh"
run_test_script "$(dirname "$0")/test-video.sh"
run_test_script "$(dirname "$0")/test-moderation.sh"
run_test_script "$(dirname "$0")/test-labels.sh"
run_test_script "$(dirname "$0")/test-settings.sh"
run_test_script "$(dirname "$0")/test-posts.sh"

# Print summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Total test suites: $total_tests"
echo -e "${GREEN}Passed: $passed_tests${NC}"
echo -e "${RED}Failed: $failed_tests${NC}"
echo ""

if [ $failed_tests -eq 0 ]; then
    echo -e "${GREEN}All tests completed successfully!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Check output above for details.${NC}"
    exit 1
fi

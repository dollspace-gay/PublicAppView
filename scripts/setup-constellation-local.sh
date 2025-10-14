#!/bin/bash
# Setup script for local Constellation deployment (Phase 2)
# This script initializes a local Constellation instance with Docker workers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Print banner
print_banner() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                                            ║${NC}"
    echo -e "${BLUE}║        🌌 Constellation Local Setup (Phase 2) 🌌         ║${NC}"
    echo -e "${BLUE}║                                                            ║${NC}"
    echo -e "${BLUE}║  Self-hosted AT Protocol Backlink Index with Docker       ║${NC}"
    echo -e "${BLUE}║                                                            ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if docker daemon is running
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    
    print_success "All prerequisites met!"
}

# Create data directory
create_data_directory() {
    print_info "Creating Constellation data directory..."
    
    local data_dir="${PROJECT_ROOT}/constellation-data"
    
    if [ -d "$data_dir" ]; then
        print_warning "Data directory already exists at: $data_dir"
        read -p "Do you want to keep existing data? (y/n): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "Removing existing data..."
            rm -rf "$data_dir"
            mkdir -p "$data_dir"
            print_success "Created fresh data directory"
        else
            print_info "Keeping existing data"
        fi
    else
        mkdir -p "$data_dir"
        print_success "Created data directory at: $data_dir"
    fi
    
    # Set permissions
    chmod 755 "$data_dir"
}

# Create environment file
create_env_file() {
    print_info "Setting up environment configuration..."
    
    local env_file="${PROJECT_ROOT}/.env.constellation-local"
    local example_file="${PROJECT_ROOT}/.env.constellation-local.example"
    
    if [ -f "$env_file" ]; then
        print_warning "Environment file already exists at: $env_file"
        read -p "Do you want to overwrite it? (y/n): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Keeping existing environment file"
            return
        fi
    fi
    
    if [ -f "$example_file" ]; then
        cp "$example_file" "$env_file"
        print_success "Created environment file from example"
    else
        print_error "Example environment file not found at: $example_file"
        exit 1
    fi
    
    # Prompt for configuration
    echo ""
    print_info "Configuration options:"
    echo ""
    
    # Jetstream URL
    echo "Select Jetstream endpoint:"
    echo "  1) US East (Primary) - wss://jetstream1.us-east.bsky.network/subscribe"
    echo "  2) US East (Secondary) - wss://jetstream2.us-east.bsky.network/subscribe"
    echo "  3) US West - wss://jetstream1.us-west.bsky.network/subscribe"
    read -p "Choose [1-3] (default: 2): " jetstream_choice
    
    case ${jetstream_choice:-2} in
        1) jetstream_url="wss://jetstream1.us-east.bsky.network/subscribe" ;;
        2) jetstream_url="wss://jetstream2.us-east.bsky.network/subscribe" ;;
        3) jetstream_url="wss://jetstream1.us-west.bsky.network/subscribe" ;;
        *) jetstream_url="wss://jetstream2.us-east.bsky.network/subscribe" ;;
    esac
    
    # Update env file
    sed -i.bak "s|JETSTREAM_URL=.*|JETSTREAM_URL=$jetstream_url|" "$env_file"
    rm -f "${env_file}.bak"
    
    print_success "Environment configured!"
    echo ""
    print_info "You can edit $env_file to customize further"
}

# Build Docker images
build_images() {
    print_info "Building Constellation Docker image..."
    print_warning "This may take 10-15 minutes on first run (Rust compilation)"
    echo ""
    
    cd "$PROJECT_ROOT"
    
    # Build constellation image
    if docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml build constellation-local; then
        print_success "Constellation image built successfully!"
    else
        print_error "Failed to build Constellation image"
        exit 1
    fi
}

# Start services
start_services() {
    print_info "Starting Constellation services..."
    echo ""
    
    cd "$PROJECT_ROOT"
    
    # Load environment
    if [ -f ".env.constellation-local" ]; then
        export $(cat .env.constellation-local | grep -v '^#' | xargs)
    fi
    
    # Start constellation-local and dependencies
    if docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml up -d constellation-local; then
        print_success "Constellation service started!"
    else
        print_error "Failed to start Constellation service"
        exit 1
    fi
    
    echo ""
    print_info "Waiting for Constellation to become healthy..."
    
    # Wait for health check
    max_attempts=30
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker-compose ps constellation-local | grep -q "healthy"; then
            print_success "Constellation is healthy and ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    
    echo ""
    print_warning "Constellation is still starting up. This is normal for first run."
    print_info "Monitor progress with: docker-compose logs -f constellation-local"
}

# Update app configuration
update_app_config() {
    print_info "Updating AppView configuration..."
    
    local main_env="${PROJECT_ROOT}/.env"
    
    # Backup existing .env if it exists
    if [ -f "$main_env" ]; then
        cp "$main_env" "${main_env}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Update or add constellation settings
    if grep -q "CONSTELLATION_URL=" "$main_env" 2>/dev/null; then
        sed -i.bak "s|CONSTELLATION_URL=.*|CONSTELLATION_URL=http://constellation-local:8080|" "$main_env"
    else
        echo "CONSTELLATION_URL=http://constellation-local:8080" >> "$main_env"
    fi
    
    if grep -q "CONSTELLATION_LOCAL=" "$main_env" 2>/dev/null; then
        sed -i.bak "s|CONSTELLATION_LOCAL=.*|CONSTELLATION_LOCAL=true|" "$main_env"
    else
        echo "CONSTELLATION_LOCAL=true" >> "$main_env"
    fi
    
    if grep -q "CONSTELLATION_ENABLED=" "$main_env" 2>/dev/null; then
        sed -i.bak "s|CONSTELLATION_ENABLED=.*|CONSTELLATION_ENABLED=true|" "$main_env"
    else
        echo "CONSTELLATION_ENABLED=true" >> "$main_env"
    fi
    
    rm -f "${main_env}.bak"
    
    print_success "AppView configuration updated!"
}

# Restart app service
restart_app() {
    print_info "Restarting AppView to apply changes..."
    
    cd "$PROJECT_ROOT"
    
    if docker-compose restart app; then
        print_success "AppView restarted!"
    else
        print_warning "Failed to restart AppView. You may need to restart manually."
    fi
}

# Print next steps
print_next_steps() {
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                  🎉 Setup Complete! 🎉                     ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    print_info "Your local Constellation instance is now running!"
    echo ""
    print_info "Useful commands:"
    echo ""
    echo "  📊 Check status:"
    echo "     docker-compose ps constellation-local"
    echo ""
    echo "  📋 View logs:"
    echo "     docker-compose logs -f constellation-local"
    echo ""
    echo "  🔍 Test API:"
    echo "     curl http://localhost:8080/"
    echo ""
    echo "  💾 Check disk usage:"
    echo "     du -sh ./constellation-data"
    echo ""
    echo "  🔄 Restart service:"
    echo "     docker-compose restart constellation-local"
    echo ""
    echo "  🛑 Stop service:"
    echo "     docker-compose stop constellation-local"
    echo ""
    print_warning "Note: Initial indexing starts from current time."
    print_info "Historical data requires manual backfill (see microcosm-rs docs)."
    echo ""
    print_info "Constellation uses ~2GB/day of storage."
    print_info "Monitor disk space and set up log rotation as needed."
    echo ""
}

# Main execution
main() {
    print_banner
    
    check_prerequisites
    echo ""
    
    create_data_directory
    echo ""
    
    create_env_file
    echo ""
    
    # Ask if user wants to build now or later
    read -p "Do you want to build and start Constellation now? (y/n): " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        build_images
        echo ""
        
        start_services
        echo ""
        
        update_app_config
        echo ""
        
        # Ask if user wants to restart app
        read -p "Do you want to restart AppView now to apply changes? (y/n): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            restart_app
        else
            print_info "Remember to restart AppView manually to apply changes:"
            print_info "  docker-compose restart app"
        fi
    else
        print_info "Setup files created. To build and start later, run:"
        print_info "  docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml up -d"
    fi
    
    echo ""
    print_next_steps
}

# Run main function
main "$@"

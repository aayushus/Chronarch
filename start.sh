#!/usr/bin/env bash
# ==============================================================================
# Chronarch Service Launcher & Lifecycle Manager
# ==============================================================================
# Usage:
#   ./start.sh              # Start or gracefully restart stack (prompts if running)
#   ./start.sh --restart    # Force graceful restart without prompt
#   ./start.sh --status     # Check health status of all Chronarch services
#   ./start.sh --stop       # Gracefully stop all services
#   ./start.sh --prod       # Run using production image-pull compose file
#   ./start.sh --dev        # Run using dev compose hot-reload overlay
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="infra/docker-compose.yml"
COMPOSE_DEV="infra/docker-compose.dev.yml"
COMPOSE_PROD="infra/docker-compose.prod.yml"
ENV_FILE=".env"
MODE="standard"
ACTION="start"

# ANSI color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
RED="\033[0;31m"
NC="\033[0m"

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart|-r)
      ACTION="restart"
      shift
      ;;
    --status|-s)
      ACTION="status"
      shift
      ;;
    --stop)
      ACTION="stop"
      shift
      ;;
    --prod)
      MODE="prod"
      shift
      ;;
    --dev)
      MODE="dev"
      shift
      ;;
    --help|-h)
      echo -e "${BOLD}Chronarch Start Script${NC}"
      echo "Usage: ./start.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -r, --restart   Gracefully restart running containers"
      echo "  -s, --status    Show status of all services"
      echo "      --stop      Gracefully shut down containers"
      echo "      --dev       Start with development hot-reload overlay"
      echo "      --prod      Start using production pre-built images"
      echo "  -h, --help      Show this help message"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Resolve docker compose command flags
get_compose_cmd() {
  local cmd=("docker" "compose" "--env-file" "$ENV_FILE")
  if [[ "$MODE" == "prod" ]]; then
    cmd+=("-f" "$COMPOSE_PROD")
  elif [[ "$MODE" == "dev" ]]; then
    cmd+=("-f" "$COMPOSE_FILE" "-f" "$COMPOSE_DEV")
  else
    cmd+=("-f" "$COMPOSE_FILE")
  fi
  echo "${cmd[@]}"
}

# Check Docker engine availability
check_docker() {
  if ! command -v docker &>/dev/null; then
    log_error "Docker CLI is not installed or not in PATH."
    exit 1
  fi

  if ! docker info &>/dev/null; then
    log_error "Docker daemon is not running. Please start Docker (or Colima) and try again."
    exit 1
  fi
}

# Ensure .env exists with required secrets
check_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    log_warn "No .env file found. Creating one from .env.example..."
    if [[ -f ".env.example" ]]; then
      cp .env.example "$ENV_FILE"
    else
      log_error ".env.example not found. Please provide an environment file."
      exit 1
    fi
  fi

  # Auto-generate required secrets if empty/unset
  local updated=0

  # Check JWT_SECRET
  if ! grep -q '^JWT_SECRET=[^[:space:]]' "$ENV_FILE" 2>/dev/null || grep -q '^JWT_SECRET=$' "$ENV_FILE" 2>/dev/null; then
    log_info "Generating secure random JWT_SECRET in .env..."
    local new_jwt
    new_jwt=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 36)
    if grep -q '^JWT_SECRET=' "$ENV_FILE"; then
      sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=${new_jwt}|" "$ENV_FILE" 2>/dev/null || sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${new_jwt}|" "$ENV_FILE"
    else
      echo "JWT_SECRET=${new_jwt}" >> "$ENV_FILE"
    fi
    updated=1
  fi

  # Check POSTGRES_PASSWORD
  if ! grep -q '^POSTGRES_PASSWORD=[^[:space:]]' "$ENV_FILE" 2>/dev/null || grep -q '^POSTGRES_PASSWORD=$' "$ENV_FILE" 2>/dev/null; then
    log_info "Setting default POSTGRES_PASSWORD in .env..."
    local new_db_pass
    new_db_pass=$(python3 -c "import secrets; print(secrets.token_hex(16))" 2>/dev/null || openssl rand -hex 16)
    if grep -q '^POSTGRES_PASSWORD=' "$ENV_FILE"; then
      sed -i '' "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${new_db_pass}|" "$ENV_FILE" 2>/dev/null || sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${new_db_pass}|" "$ENV_FILE"
    else
      echo "POSTGRES_PASSWORD=${new_db_pass}" >> "$ENV_FILE"
    fi
    updated=1
  fi

  # Check TOKEN_ENCRYPTION_KEY
  if ! grep -q '^TOKEN_ENCRYPTION_KEY=[^[:space:]]' "$ENV_FILE" 2>/dev/null || grep -q '^TOKEN_ENCRYPTION_KEY=$' "$ENV_FILE" 2>/dev/null; then
    log_info "Generating Fernet TOKEN_ENCRYPTION_KEY in .env..."
    local new_enc_key
    new_enc_key=$(python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())" 2>/dev/null || openssl rand -base64 32)
    if grep -q '^TOKEN_ENCRYPTION_KEY=' "$ENV_FILE"; then
      sed -i '' "s|^TOKEN_ENCRYPTION_KEY=.*|TOKEN_ENCRYPTION_KEY=${new_enc_key}|" "$ENV_FILE" 2>/dev/null || sed -i "s|^TOKEN_ENCRYPTION_KEY=.*|TOKEN_ENCRYPTION_KEY=${new_enc_key}|" "$ENV_FILE"
    else
      echo "TOKEN_ENCRYPTION_KEY=${new_enc_key}" >> "$ENV_FILE"
    fi
    updated=1
  fi

  if [[ $updated -eq 1 ]]; then
    log_success "Environment secrets initialized."
  fi
}

# Determine if containers are currently running
is_running() {
  local compose_cmd
  compose_cmd=$(get_compose_cmd)
  local running_count
  running_count=$($compose_cmd ps --filter "status=running" -q 2>/dev/null | wc -l | tr -d ' ')
  [[ "$running_count" -gt 0 ]]
}

# Perform status check
show_status() {
  local compose_cmd
  compose_cmd=$(get_compose_cmd)
  log_info "Chronarch container status:"
  $compose_cmd ps
}

# Perform graceful stop
stop_services() {
  local compose_cmd
  compose_cmd=$(get_compose_cmd)
  log_info "Gracefully stopping Chronarch services..."
  $compose_cmd stop -t 15
  log_success "All services stopped."
}

# Graceful restart
restart_services() {
  local compose_cmd
  compose_cmd=$(get_compose_cmd)
  log_info "Performing graceful restart of Chronarch..."
  $compose_cmd restart -t 15
  log_success "Services restarted."
  show_status
}

# Start or launch stack
start_services() {
  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  if is_running; then
    log_warn "Chronarch is already running."
    if [[ "$ACTION" == "restart" ]]; then
      restart_services
      return
    fi

    echo -e -n "${BOLD}Would you like to perform a graceful restart? [Y/n]: ${NC}"
    read -r response || response="y"
    case "$response" in
      [nN][oO]|[nN])
        log_info "Leaving existing services untouched."
        show_status
        return
        ;;
      *)
        restart_services
        return
        ;;
    esac
  fi

  log_info "Starting Chronarch stack (mode: $MODE)..."
  if [[ "$MODE" == "prod" ]]; then
    $compose_cmd up -d
  else
    $compose_cmd up -d --build
  fi

  log_success "Chronarch stack launched!"
  echo ""
  echo -e "${BOLD}Access Points:${NC}"
  echo -e "  • Web UI:        ${GREEN}http://localhost:3000${NC}"
  echo -e "  • API Server:    ${GREEN}http://localhost:8000${NC} (Docs: /docs)"
  echo -e "  • MCP Server:    ${GREEN}http://localhost:8001${NC}"
  echo -e "  • LiteLLM Proxy: ${GREEN}http://localhost:4000${NC}"
  echo ""
  show_status
}

# Main routing
main() {
  check_docker
  check_env

  case "$ACTION" in
    status)
      show_status
      ;;
    stop)
      stop_services
      ;;
    restart)
      restart_services
      ;;
    start)
      start_services
      ;;
  esac
}

main "$@"

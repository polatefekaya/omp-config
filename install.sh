#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$HOME/.config/omp"
OMP_DIR="$HOME/.omp"
ENV_FILE="$HOME/.omp.env"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}warn:${NC} $1"; }
fail() { echo -e "${RED}error:${NC} $1"; exit 1; }

OS="$(uname -s)"
log "Detected OS: $OS"

install_node_macos() {
  if ! command -v brew &>/dev/null; then
    fail "Homebrew not found. Install it first: https://brew.sh"
  fi
  log "Installing Node.js via Homebrew..."
  brew install node
}

install_node_linux() {
  if command -v pacman &>/dev/null; then
    log "Installing Node.js via pacman (CachyOS/Arch)..."
    sudo pacman -S --noconfirm nodejs npm
  elif command -v apt-get &>/dev/null; then
    log "Installing Node.js via apt..."
    sudo apt-get install -y nodejs npm
  else
    fail "Could not detect package manager. Install Node.js manually: https://nodejs.org"
  fi
}

if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing..."
  if [ "$OS" = "Darwin" ]; then install_node_macos
  else install_node_linux
  fi
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js 20+ required. Found: $(node -v)"
fi

log "Node.js $(node -v) — OK"

if ! command -v omp &>/dev/null; then
  log "Installing oh-my-pi..."
  curl -fsSL https://omp.sh/install | sh
else
  log "oh-my-pi already installed — skipping"
fi

log "Installing swarm extension..."
PUPPETEER_SKIP_DOWNLOAD=true npm install -g @oh-my-pi/swarm-extension

if [ -L "$OMP_DIR" ]; then
  warn "~/.omp symlink already exists — skipping"
elif [ -d "$OMP_DIR" ]; then
  warn "~/.omp directory exists — backing up to ~/.omp.bak"
  mv "$OMP_DIR" "$HOME/.omp.bak"
  ln -s "$DOTFILES_DIR" "$OMP_DIR"
  log "Symlinked ~/.config/omp → ~/.omp"
else
  ln -s "$DOTFILES_DIR" "$OMP_DIR"
  log "Symlinked ~/.config/omp → ~/.omp"
fi

log "Creating directory structure..."
mkdir -p "$DOTFILES_DIR/skills"
mkdir -p "$DOTFILES_DIR/agent/skills"
mkdir -p "$DOTFILES_DIR/agent/extensions"

detect_shell_rc() {
  if [ "$OS" = "Darwin" ]; then
    echo "$HOME/.zshrc"
    return
  fi

  local shell_name
  shell_name="$(basename "${SHELL:-bash}")"

  case "$shell_name" in
    zsh)  echo "$HOME/.zshrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.bashrc" ;;
  esac
}

SHELL_RC="$(detect_shell_rc)"
log "Shell RC: $SHELL_RC"

ENV_LINE='[ -f "$HOME/.omp.env" ] && source "$HOME/.omp.env"'
if ! grep -q "omp.env" "$SHELL_RC" 2>/dev/null; then
  echo "" >> "$SHELL_RC"
  echo "# oh-my-pi secrets" >> "$SHELL_RC"
  echo "$ENV_LINE" >> "$SHELL_RC"
  log "Added .omp.env source to $SHELL_RC"
else
  warn ".omp.env already sourced in $SHELL_RC — skipping"
fi

if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE from example..."
  cp "$DOTFILES_DIR/.omp.env.example" "$ENV_FILE"
  warn "Fill in your API keys in $ENV_FILE before running omp"
else
  warn "$ENV_FILE already exists — not overwriting"
fi

log "Verifying installation..."
if command -v omp &>/dev/null; then
  log "omp — $(omp --version 2>/dev/null || echo 'installed')"
else
  fail "omp not found after install — check your PATH: $(npm bin -g)"
fi

echo ""
echo -e "${GREEN}Done.${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit ~/.omp.env with your API keys"
echo "  2. Restart your shell or run: source $SHELL_RC"
echo "  3. cd into a project and run: omp"
echo "  4. Run /init-context to generate .omp/CONTEXT.md for that project"
echo ""
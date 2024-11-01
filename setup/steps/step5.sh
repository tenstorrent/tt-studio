#!/bin/bash
# Step 5: Installing Rust, tt-flash, and Flashing Firmware

# Set up absolute paths based on this script's location
STEP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_DIR="$STEP_DIR/"
ENV_FILE="$SETUP_DIR/inputs/common.env"
COMMON_SH="$SETUP_DIR/common.sh"

if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
else
    echo "⛔ Environment file $ENV_FILE not found."
    exit 1
fi

if [[ -f "$COMMON_SH" ]]; then
    source "$COMMON_SH"
else
    echo "⛔ Common functions file $COMMON_SH not found."
    exit 1
fi

log "Step 5: Installing Rust, tt-flash, and Flashing Firmware"
load_env

if [ -d "$HOME/.cargo" ]; then
    log "Removing existing Rust installation..."
    run_command "remove existing Rust installation" "rm -rf \"$HOME/.cargo\" \"$HOME/.rustup\""
fi

log "Installing Rust..."
run_command "install Rust" "curl --proto '=https' --tlsv1.2 -sSf $RUST_INSTALL_URL | sh -s -- -y --default-toolchain stable"
export PATH="$HOME/.cargo/bin:$PATH"
run_command "set Rust default to stable" "rustup default stable"
run_command "verify Rust installation" "rustc --version"
run_command "verify Cargo installation" "cargo --version"

if [ ! -d "$VENV_PATH" ]; then
    log "Creating Python virtual environment..."
    run_command "create Python virtual environment" "python3 -m venv \"$VENV_PATH\""
    log "Virtual environment created at $VENV_PATH"
fi

. "$VENV_PATH/bin/activate"
log "Activated virtual environment"

run_command "upgrade pip, wheel, and setuptools" "$VENV_PATH/bin/pip install --upgrade pip wheel setuptools"

if [ -d "$TT_FLASH_REPO" ]; then
    cd "$TT_FLASH_REPO" || { log "⛔ Failed to navigate to $TT_FLASH_REPO"; exit 1; }
    log "📂 Navigated to tt-flash repository at $TT_FLASH_REPO"
else
    log "⛔ tt-flash repository not found at $TT_FLASH_REPO. Exiting."
    exit 1
fi

run_command "install tt-flash" "$VENV_PATH/bin/pip install ."

if ! "$VENV_PATH/bin/tt-flash" -h; then
    log "⛔ tt-flash -h command failed. Exiting."
    exit 1
fi

log "🎉 Step 5: Rust and tt-flash installed successfully."

log "Flashing firmware using tt-flash"

if [ -f "$FIRMWARE_PATH" ]; then
    log "📂 Firmware file found at $FIRMWARE_PATH"
else
    log "⛔ Firmware file not found at $FIRMWARE_PATH. Exiting."
    exit 1
fi

run_command "flash firmware using tt-flash" "$VENV_PATH/bin/tt-flash flash --fw-tar \"$FIRMWARE_PATH\""

log "🎉 Firmware flashing completed successfully."

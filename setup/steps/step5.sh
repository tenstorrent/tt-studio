#!/bin/bash


log() {
    echo "$1"
    echo "$1" >> /var/log/step5.log 
}

run_command() {
    local description="$1"
    local command="$2"

    log "$description"
    eval "$command" || { log "Failed to $description"; exit 1; }
}


log "Reading environment variables from common.env"
source inputs/common.env

# Step 5: Install Rust, tt-flash, and Flash Firmware
log "Step 5: Install Rust, tt-flash, and Flash Firmware"

# Remove existing Rust installation if present
if [ -d "$HOME/.cargo" ]; then
    log "Removing existing Rust installation..."
    run_command "remove existing Rust installation" "rm -rf \"$HOME/.cargo\" \"$HOME/.rustup\""
fi

# Install Rust
log "Installing Rust..."
run_command "install Rust" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
export PATH="$HOME/.cargo/bin:$PATH"
run_command "set Rust default to stable" "rustup default stable"
run_command "verify Rust installation" "rustc --version"
run_command "verify Cargo installation" "cargo --version"

# Create Python virtual environment if not exists
if [ ! -d "$VENV_PATH" ]; then
    log "Creating Python virtual environment..."
    run_command "create Python virtual environment" "python3 -m venv \"$VENV_PATH\""
    log "Virtual environment created at $VENV_PATH"
fi

# Activate the virtual environment
. "$VENV_PATH/bin/activate"
log "Activated virtual environment"

# Set the path to the virtual environment's Python and pip
VENV_PYTHON="$VENV_PATH/bin/python"
VENV_PIP="$VENV_PATH/bin/pip"

# Upgrade pip and install wheel
run_command "upgrade pip, wheel, and setuptools" "$VENV_PIP install --upgrade pip wheel setuptools"

# Check if the tt-flash repository directory exists
if [ -d "$TT_FLASH_REPO" ]; then
    cd "$TT_FLASH_REPO" || { log "Failed to navigate to $TT_FLASH_REPO"; exit 1; }
    log "Navigated to tt-flash repository at $TT_FLASH_REPO"
else
    log "tt-flash repository not found at $TT_FLASH_REPO. Exiting."
    exit 1
fi

# Install tt-flash using pip
log "Installing tt-flash using pip..."
run_command "install tt-flash" "$VENV_PIP install ."

# Verify that tt-flash is installed and accessible
if ! "$VENV_PATH/bin/tt-flash" -h; then
    log "tt-flash -h command failed. Exiting."
    exit 1
fi

log "Step 5 completed successfully: Rust and tt-flash installed."

# Flash firmware using tt-flash
log "Flashing firmware using tt-flash"

# Check if the firmware file exists
if [ -f "$FIRMWARE_PATH" ]; then
    log "Firmware file found at $FIRMWARE_PATH"
else
    log "Firmware file not found at $FIRMWARE_PATH. Exiting."
    exit 1
fi

# Flash the firmware using tt-flash
run_command "flash firmware using tt-flash" "$VENV_PATH/bin/tt-flash flash --fw-tar \"$FIRMWARE_PATH\""

log "Firmware flashing completed successfully."

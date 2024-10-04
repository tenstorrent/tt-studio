#!/bin/bash
source ./common.sh

log "Step 3: Setting up Hugepages"
load_env

if [ -d "$TT_SYSTEM_TOOLS_DIR" ]; then
    cd "$TT_SYSTEM_TOOLS_DIR" || { log "⛔ Failed to navigate to $TT_SYSTEM_TOOLS_DIR"; exit 1; }
    log "📂 Navigated to $TT_SYSTEM_TOOLS_DIR"
else
    log "⛔ Directory $TT_SYSTEM_TOOLS_DIR does not exist. Exiting."
    exit 1
fi

run_command "make $HUGEPAGES_SCRIPT executable" "chmod +x ./$HUGEPAGES_SCRIPT"

# steps simlar to tt buda demos
# Run the hugepages-setup.sh script
run_command "run $HUGEPAGES_SCRIPT" "sudo ./$HUGEPAGES_SCRIPT"

# Download and install the Tenstorrent tools .deb package
run_command "download $DEB_PACKAGE_NAME" "wget $DEB_PACKAGE_URL"
run_command "install $DEB_PACKAGE_NAME" "sudo dpkg -i $DEB_PACKAGE_NAME"

# Enable and start services
run_command "enable and start $HUGEPAGES_SERVICE" "sudo systemctl enable --now $HUGEPAGES_SERVICE"
run_command "enable and start $MOUNT_SERVICE" "sudo systemctl enable --now $MOUNT_SERVICE"

# Reboot the system
run_command "reboot the system" "sudo reboot"

log "🎉 Step 3: Hugepages setup completed successfully."

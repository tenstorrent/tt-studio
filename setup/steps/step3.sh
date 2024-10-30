#!/bin/bash
# Step 3: Setting up Hugepages

source ./common.sh

# Check if the script is run with sudo privileges
if [ "$EUID" -ne 0 ]; then
  echo "⚠️  Step 3 must be run with sudo access. Please run the script with sudo:"
  echo "    sudo ./master.sh step3"
  exit 1
fi

log "Step 3: Setting up Hugepages"
load_env

# Ensure that the tt-system-tools directory exists
if [ -d "$TT_SYSTEM_TOOLS_DIR" ]; then
    cd "$TT_SYSTEM_TOOLS_DIR" || { log "⛔ Failed to navigate to $TT_SYSTEM_TOOLS_DIR"; exit 1; }
    log "📂 Navigated to $TT_SYSTEM_TOOLS_DIR"
else
    log "⛔ Directory $TT_SYSTEM_TOOLS_DIR does not exist. Exiting."
    exit 1
fi

# Run the steps you tested manually:
log "Making hugepages-setup.sh executable"
chmod +x hugepages-setup.sh

log "Running hugepages-setup.sh"
sudo ./hugepages-setup.sh

log "Downloading and installing tenstorrent-tools .deb"
wget https://github.com/tenstorrent/tt-system-tools/releases/download/upstream%2F1.1/tenstorrent-tools_1.1-5_all.deb
sudo dpkg -i tenstorrent-tools_1.1-5_all.deb

log "Starting services: tenstorrent-hugepages.service and dev-hugepages\x2d1G.mount"
sudo systemctl enable --now tenstorrent-hugepages.service
sudo systemctl enable --now 'dev-hugepages\x2d1G.mount'

# Prompt the user for system reboot
log "⚠️ A system reboot is required for the changes to take effect."
read -p "Would you like to reboot now? (y/n): " user_input

if [[ "$user_input" == "y" || "$user_input" == "Y" ]]; then
    log "Rebooting system..."
    sudo reboot
else
    log "Please remember to reboot the system later to apply the changes."
fi

log "🎉 Step 3: Hugepages setup completed successfully."

FROM debian:bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    procps \
    libasound2 \
    libusb-1.0-0 \
    libftdi1-2 \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Add Massimo Callegari's QLC+ OBS repository and GPG key for Debian 12 (Bookworm)
RUN echo 'deb http://download.opensuse.org/repositories/home:/mcallegari79/Debian_12/ /' > /etc/apt/sources.list.d/home-mcallegari79.list \
    && curl -fsSL https://download.opensuse.org/repositories/home:mcallegari79/Debian_12/Release.key | gpg --dearmor > /etc/apt/trusted.gpg.d/home_mcallegari79.gpg

# Install QLC+ (qt5 build)
RUN apt-get update && apt-get install -y --no-install-recommends \
    qlcplus5 \
    qml6-module-qtquick-controls \
    qml6-module-qtquick-layouts \
    qml6-module-qtquick-templates \
    qml6-module-qtquick-window \
    qml6-module-qtquick \
    && rm -rf /var/lib/apt/lists/*

# Append custom CSS overrides for QLC+ v5 Web UI frame headers/titles
RUN echo '\n/* Custom Overrides for Frame Titles */\n.frame-title {\n  display: block !important;\n  font-size: calc(var(--text-size-default) * 0.55) !important;\n  font-weight: 600 !important;\n  white-space: nowrap !important;\n  overflow: hidden !important;\n  text-overflow: ellipsis !important;\n  padding-left: 6px !important;\n  padding-right: 6px !important;\n  text-align: left !important;\n  margin-right: auto !important;\n  line-height: var(--list-item-height) !important;\n}' >> /usr/share/qlcplus/web/webaccess-v5.css

# Create directories for fixtures and project
RUN mkdir -p /root/.qlcplus/fixtures /QLC

# Copy default fixtures into the image
COPY config/fixtures/ /usr/share/qlcplus/fixtures/

# Set Qt offscreen rendering for headless execution
ENV QT_QPA_PLATFORM=offscreen

# Expose ports:
# 9999/tcp: Web interface
# 7700/udp: OSC input channel receiver
# 6454/udp: ArtNet output
EXPOSE 9999/tcp 7700/udp 6454/udp

# Entrypoint script setup
COPY config/qlcplus/entrypoint.sh /QLC/entrypoint.sh
RUN chmod +x /QLC/entrypoint.sh

ENTRYPOINT ["/QLC/entrypoint.sh"]

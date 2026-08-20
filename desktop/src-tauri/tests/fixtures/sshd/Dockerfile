FROM alpine:3.20

# Minimal sshd fixture for the tunnel integration tests: a locked-down
# pubkey-only sshd plus a busybox httpd on 127.0.0.1:8088 that serves a
# marker file — the "remote service" the tunnel forwards to. Host keys are
# generated at image build time so they stay stable across container
# restarts (the reconnect test depends on that).
RUN apk add --no-cache openssh busybox-extras \
    && ssh-keygen -A \
    && adduser -D -s /bin/sh tunnel \
    && sed -i 's/^tunnel:!/tunnel:*/' /etc/shadow \
    && mkdir -p /srv \
    && echo "tt-studio-tunnel-fixture" > /srv/index.html

COPY sshd_config /etc/ssh/sshd_config

EXPOSE 22
CMD ["/bin/sh", "-c", "httpd -p 127.0.0.1:8088 -h /srv && exec /usr/sbin/sshd -D -e"]

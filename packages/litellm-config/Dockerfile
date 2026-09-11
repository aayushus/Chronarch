FROM ghcr.io/berriai/litellm:main-stable

# Baked in at build time (COPY, not a bind mount) — sidesteps virtiofs
# bind-mount quirks seen on some Colima setups where a freshly-created host
# file is briefly presented as a directory to the guest.
COPY config.yaml /app/config.yaml
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# The entrypoint prefers UI-generated config from the shared volume
# (/app/dynamic, mounted by compose) and falls back to the baked default.
ENTRYPOINT ["/app/docker-entrypoint.sh"]

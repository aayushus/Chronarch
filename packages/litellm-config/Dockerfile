FROM ghcr.io/berriai/litellm:main-stable

# Baked in at build time (COPY, not a bind mount) — sidesteps virtiofs
# bind-mount quirks seen on some Colima setups where a freshly-created host
# file is briefly presented as a directory to the guest.
COPY config.yaml /app/config.yaml

CMD ["--config", "/app/config.yaml", "--port", "4000"]

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    pipewire pipewire-bin pipewire-pulse wireplumber pulseaudio-utils dbus dbus-user-session python3 \
 && rm -rf /var/lib/apt/lists/*
COPY run.sh /run.sh
CMD ["dbus-run-session", "--", "bash", "/run.sh"]

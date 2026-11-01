# The clean machines of the packaged trial (DSP-153): Ubuntu 24.04 with no Node, no npm and no
# DSpatch sources. One image, two roles: `tester` installs the .deb, `hostuser` is the remote
# account. See run.mjs.
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server openssh-client xvfb procps ca-certificates xauth dbus gnome-keyring libsecret-1-0 \
    libgtk-3-0t64 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0t64 libsecret-1-0 libasound2t64 libgbm1 git \
  && useradd -m -s /bin/bash tester \
  && useradd -m -s /bin/bash hostuser \
  && echo 'hostuser:trial-password' | chpasswd \
  && mkdir -p /run/sshd

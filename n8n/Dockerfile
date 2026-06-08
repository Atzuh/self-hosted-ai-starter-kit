FROM python:3.11-alpine AS python-runtime

RUN python3 -m pip install --no-cache-dir python-docx pyspellchecker

FROM n8nio/n8n:latest

USER root

# n8n hardened image has no package manager.
# Copy a ready Python runtime from an Alpine Python stage.
COPY --from=python-runtime /usr/local /usr/local
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python

# Compose runs n8n as root for shared volume file access.
USER root

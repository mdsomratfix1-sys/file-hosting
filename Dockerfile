FROM python:3.12-slim-bookworm

WORKDIR /app

# ffmpeg + basic tools (yt-dlp needs ffmpeg for many sites)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets PORT automatically
ENV PYTHONUNBUFFERED=1
ENV DOWNLOAD_DIR=/tmp/downloads

RUN mkdir -p /tmp/downloads

EXPOSE 10000

CMD ["python", "main.py"]

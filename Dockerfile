FROM node:20-slim

# Conditionally install Chromium (set INSTALL_CHROMIUM=false to skip for Firecrawl-only deployments)
ARG INSTALL_CHROMIUM=true
RUN if [ "$INSTALL_CHROMIUM" = "true" ]; then \
    apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc-s1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libxss1 \
    libxtst6 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*; \
  fi

# Tell Puppeteer to use installed Chromium (no-op if Chromium not installed)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app
COPY . .

# Run as non-root user (Puppeteer already uses --no-sandbox)
RUN groupadd -r appuser && useradd -r -g appuser -m appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

CMD ["node", "server.js"]

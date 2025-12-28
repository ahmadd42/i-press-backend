FROM node:20-bookworm

# Install ImageMagick
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install node dependencies
RUN npm install --omit=dev

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "app.js"]

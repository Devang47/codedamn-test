FROM node:20

WORKDIR /app

# Install dependencies required for mediasoup
RUN apt-get update && \
    apt-get install -y net-tools build-essential python3 python3-pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install

# Copy application files
COPY . .

# Expose the server port
EXPOSE 3000

# Expose the range of ports for WebRTC
EXPOSE 40000-49999/udp
EXPOSE 40000-49999/tcp

# Start the server
CMD ["node", "server.js"]

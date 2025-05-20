# MediaSoup Video Conference

A simple video conferencing application built with MediaSoup and WebRTC.

## Setup and Installation

1. Install Node.js dependencies:

```
npm install
```

2. Start the server:

```
npm start
```

3. Access the application in your browser:

```
http://localhost:3000
```

## Technical Overview

This application uses:

- **MediaSoup**: A powerful WebRTC SFU (Selective Forwarding Unit) for media routing
- **Socket.IO**: For signaling and real-time communication between client and server
- **Express**: As a web server to serve static files

## Architecture

- **Client**: Manages local media streams, connection to server, and displaying remote streams
- **Server**: Handles signaling, room management, and media routing via MediaSoup

## Notes

- For production use, change the `announcedIp` in the server.js file to your server's public IP address
- This implementation uses a single room ("main-room") for simplicity, but could be extended to support multiple rooms

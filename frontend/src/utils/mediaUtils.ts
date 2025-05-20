import * as mediasoupClient from "mediasoup-client";
import { io, Socket } from "socket.io-client";

// This file will contain the functionality from the original client.js
// Since we don't have access to the content of client.js,
// we're creating a skeleton file to be filled in with the appropriate logic

let socket: Socket | null = null;

export const initializeMedia = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    return stream;
  } catch (error) {
    console.error("Error accessing media devices:", error);
    throw error;
  }
};

export const createDevice = () => {
  // Create a mediasoup device
  return new mediasoupClient.Device();
};

/**
 * Connect to the WebSocket server
 * @param url Server URL to connect to
 * @returns The socket.io connection
 */
export function connectSocket(url: string): Socket {
  console.log(`Connecting to socket.io server at: ${url}`);

  const socket = io(url, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  socket.on("connect", () => {
    console.log("Socket connected successfully", socket.id);
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
  });

  socket.on("reconnect", (attemptNumber) => {
    console.log(`Socket reconnected after ${attemptNumber} attempts`);
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  return socket;
}

export const joinRoom = async (roomId: string) => {
  // Implement the join room functionality using mediasoupClient
  console.log("Joining room:", roomId);

  if (!socket) {
    connectSocket(window.location.origin);
  }

  const device = createDevice();
  // Here you would load the device with the router RTP capabilities
  // and create a transport for sending/receiving media

  // Example of sending a join room request to the server
  socket?.emit("joinRoom", { roomId });

  return device;
};

export const leaveRoom = () => {
  // Implement the leave room functionality from client.js
  console.log("Leaving room");

  // Example of sending a leave room request to the server
  socket?.emit("leaveRoom");
};

export const toggleAudio = (stream: MediaStream) => {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length > 0) {
    const enabled = !audioTracks[0].enabled;
    audioTracks.forEach((track) => {
      track.enabled = enabled;
    });
    return enabled;
  }
  return false;
};

export const toggleVideo = (stream: MediaStream) => {
  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length > 0) {
    const enabled = !videoTracks[0].enabled;
    videoTracks.forEach((track) => {
      track.enabled = enabled;
    });
    return enabled;
  }
  return false;
};

/**
 * Get the ICE server configuration for WebRTC
 */
export function getIceServers() {
  return [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
    // TURN servers
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];
}

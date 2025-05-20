const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");
const fetch = require("node-fetch");

// Basic server setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(__dirname));

// MediaSoup objects
const mediasoupWorkers = [];
const numWorkers = Object.keys(require("os").cpus()).length;
let nextWorkerIndex = 0;
let workersReady = false;
const rooms = new Map();

// MediaSoup settings - simplified
const mediasoupSettings = {
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
  },
  router: {
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 },
      },
    ],
  },
  webRtcTransport: {
    listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  },
};

// Initialize MediaSoup workers
async function initializeMediasoupWorkers() {
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: mediasoupSettings.worker.logLevel,
      logTags: mediasoupSettings.worker.logTags,
      rtcMinPort: mediasoupSettings.worker.rtcMinPort,
      rtcMaxPort: mediasoupSettings.worker.rtcMaxPort,
    });
    worker.on("died", () => setTimeout(() => process.exit(1), 2000));
    mediasoupWorkers.push(worker);
  }
  workersReady = true;
}

// Helper functions - minimized
function getNextWorker() {
  const worker = mediasoupWorkers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % mediasoupWorkers.length;
  return worker;
}

async function createRouter() {
  return await getNextWorker().createRouter({
    mediaCodecs: mediasoupSettings.router.mediaCodecs,
  });
}

async function createWebRtcTransport(router, options = {}) {
  try {
    const transport = await router.createWebRtcTransport({
      ...mediasoupSettings.webRtcTransport,
      ...options,
    });

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") transport.close();
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
      transport,
    };
  } catch (error) {
    throw error;
  }
}

async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      router: await createRouter(),
      participants: new Map(),
      producers: [],
    };
    rooms.set(roomId, room);
  }
  return room;
}

function addParticipant(roomId, userId, socket) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const participant = {
    id: userId,
    socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };

  room.participants.set(userId, participant);
  return participant;
}

function removeParticipant(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(userId);
  if (!participant) return;

  // Close all transports
  for (const transport of participant.transports.values()) {
    transport.close();
  }

  room.participants.delete(userId);

  // Clean up empty rooms
  if (room.participants.size === 0) {
    room.router.close();
    rooms.delete(roomId);
  }
}

// Socket.IO connection handler
io.on("connection", (socket) => {
  let participantDetails = { roomId: null, userId: null };

  // Join room & get capabilities
  socket.on("getRouterRtpCapabilities", async ({ roomId, userId }) => {
    if (!workersReady) {
      socket.emit("error", { message: "Server not ready" });
      return;
    }

    participantDetails.roomId = roomId;
    participantDetails.userId = userId;

    try {
      const room = await getOrCreateRoom(roomId);
      const participant = addParticipant(roomId, userId, socket);
      if (!participant) {
        socket.emit("error", { message: "Could not add participant to room" });
        return;
      }

      socket.to(roomId).emit("participantJoined", { userId });
      socket.join(roomId);
      socket.emit("routerRtpCapabilities", room.router.rtpCapabilities);
    } catch (error) {
      socket.emit("error", { message: "Error getting router capabilities" });
    }
  });

  // Create transport
  socket.on(
    "createWebRtcTransport",
    async ({ type, roomId, userId, forceTcp }) => {
      try {
        if (!roomId || !userId) {
          socket.emit("error", { message: "Missing roomId or userId", type });
          return;
        }

        const room = rooms.get(roomId);
        if (!room) {
          socket.emit("error", { message: "Room not found", type });
          return;
        }

        // Get or create participant
        let participant = room.participants.get(userId);
        if (!participant) {
          participant = addParticipant(roomId, userId, socket);
          if (!participant) {
            socket.emit("error", {
              message: "Cannot add participant to room",
              type,
            });
            return;
          }
          socket.join(roomId);
        }

        // Get announcedIp (public IP)
        let announcedIp = process.env.PUBLIC_IP;
        if (!announcedIp) {
          try {
            const response = await fetch("https://api.ipify.org?format=json");
            const data = await response.json();
            announcedIp = data.ip;
          } catch (error) {
            announcedIp = "127.0.0.1";
          }
        }

        // Create transport
        const transportOptions = {
          enableUdp: !forceTcp,
          enableTcp: true,
          preferUdp: !forceTcp,
          listenIps: [{ ip: "0.0.0.0", announcedIp }],
        };

        const transportData = await createWebRtcTransport(
          room.router,
          transportOptions
        );
        participant.transports.set(transportData.id, transportData.transport);

        // Send transport data to client
        socket.emit("transportCreated", {
          type,
          id: transportData.id,
          iceParameters: transportData.iceParameters,
          iceCandidates: transportData.iceCandidates,
          dtlsParameters: transportData.dtlsParameters,
          sctpParameters: transportData.sctpParameters,
        });
      } catch (error) {
        socket.emit("error", {
          message: `Error creating transport: ${error.message}`,
          type,
        });
      }
    }
  );

  // Connect transport
  socket.on(
    "connectWebRtcTransport",
    async ({ transportId, dtlsParameters, roomId }) => {
      try {
        const room = rooms.get(roomId);
        if (!room) return;

        const participant = Array.from(room.participants.values()).find((p) =>
          p.transports.has(transportId)
        );
        if (!participant) return;

        await participant.transports
          .get(transportId)
          .connect({ dtlsParameters });
      } catch (error) {
        // Error handling is minimal but essential
      }
    }
  );

  // Produce media
  socket.on(
    "produce",
    async ({ transportId, kind, rtpParameters, roomId, userId }, callback) => {
      try {
        const room = rooms.get(roomId);
        if (!room) return callback({ error: `Room not found` });

        const participant = room.participants.get(userId);
        if (!participant) return callback({ error: `Participant not found` });

        const transport = participant.transports.get(transportId);
        if (!transport) return callback({ error: `Transport not found` });

        // Create producer
        const producer = await transport.produce({ kind, rtpParameters });
        participant.producers.set(producer.id, producer);

        // Add to room's producer list
        room.producers.push({ id: producer.id, userId, kind });

        // Cleanup on transport close
        producer.on("transportclose", () => {
          producer.close();
          participant.producers.delete(producer.id);
        });

        // Notify others
        for (const otherParticipant of room.participants.values()) {
          if (otherParticipant.id !== userId) {
            otherParticipant.socket.emit("newProducer", {
              producerId: producer.id,
              producerUserId: userId,
              kind,
            });
          }
        }

        callback({ id: producer.id });
      } catch (error) {
        callback({ error: error.message });
      }
    }
  );

  // Get existing producers
  socket.on("getProducers", ({ roomId, userId: requestingUserId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Only send producers that aren't the user's own
    const existingProducers = room.producers
      .filter((p) => p.userId !== requestingUserId)
      .map((p) => ({
        producerId: p.id,
        producerUserId: p.userId,
        kind: p.kind,
      }));

    socket.emit("existingProducers", existingProducers);
  });

  // Consume media
  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, transportId, roomId },
      callback
    ) => {
      try {
        const room = rooms.get(roomId);
        if (!room) return callback({ error: `Room not found` });

        const producerData = room.producers.find(
          (p) => p.id === remoteProducerId
        );
        if (!producerData) return callback({ error: `Producer not found` });

        const participant = Array.from(room.participants.values()).find((p) =>
          p.transports.has(transportId)
        );
        if (!participant)
          return callback({ error: "Participant or transport not found" });

        const transport = participant.transports.get(transportId);
        if (!transport) return callback({ error: `Transport not found` });

        if (
          !room.router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          return callback({ error: "Cannot consume producer" });
        }

        const consumer = await transport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });

        participant.consumers.set(consumer.id, consumer);

        // Handle cleanup
        consumer.on("transportclose", () => {
          consumer.close();
          participant.consumers.delete(consumer.id);
        });

        consumer.on("producerclose", () => {
          consumer.close();
          participant.consumers.delete(consumer.id);
          socket.emit("consumerClosed", {
            consumerId: consumer.id,
            producerId: remoteProducerId,
          });
        });

        callback({
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (error) {
        callback({ error: error.message });
      }
    }
  );

  // Resume consumer
  socket.on("resumeConsumer", async ({ consumerId, roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return;

      const participant = Array.from(room.participants.values()).find((p) =>
        p.consumers.has(consumerId)
      );
      if (!participant) return;

      const consumer = participant.consumers.get(consumerId);
      if (consumer) await consumer.resume();
    } catch (error) {
      // Minimal error handling
    }
  });

  // Leave room
  socket.on("leaveRoom", ({ roomId, userId }) => {
    if (roomId && userId) {
      socket.to(roomId).emit("participantLeft", { userId });
      socket.leave(roomId);
      removeParticipant(roomId, userId);
      participantDetails.roomId = null;
      participantDetails.userId = null;
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    const { roomId, userId } = participantDetails;
    if (roomId && userId) {
      socket.to(roomId).emit("participantLeft", { userId });
      removeParticipant(roomId, userId);
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", async () => {
  await initializeMediasoupWorkers();
  console.log(`Server listening on port ${PORT}`);
});

import * as mediasoupClient from "mediasoup-client";
import { Socket } from "socket.io-client";
import {
  createContext,
  useContext,
  type ReactNode,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { connectSocket } from "../utils/mediaUtils";

// Configuration constants
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.hostname;
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT || "3000";
const getServerUrl = () => `http://${SERVER_URL}:${SERVER_PORT}`;

// Types
type QueuedTrack = { producerId: string; producerUserId: string; kind: string };
type Participant = { id: string; consumers: Record<string, any> };
type MediaSoupState = {
  device: mediasoupClient.Device | null;
  socket: Socket | null;
  roomId: string;
  userId: string;
  producers: { audio: any | null; video: any | null };
  consumers: Array<{
    id: string;
    producerId: string;
    consumer: any;
    userId: string;
    kind: string;
  }>;
  sendTransport: any;
  recvTransport: any;
  localStream: MediaStream | null;
  isConnected: boolean;
  participants: Map<string, Participant>;
  isSpectator: boolean;
};

type MediaSoupContextType = {
  state: MediaSoupState;
  joinRoom: () => Promise<void>;
  leaveRoom: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  joinRoomAsSpectator: () => Promise<void>;
};

// Default state
const defaultState: MediaSoupState = {
  device: null,
  socket: null,
  roomId: "main-room",
  userId: `user-${Math.floor(Math.random() * 1000000)}`,
  producers: { audio: null, video: null },
  consumers: [],
  sendTransport: null,
  recvTransport: null,
  localStream: null,
  isConnected: false,
  participants: new Map(),
  isSpectator: false,
};

// Context setup
const MediaSoupContext = createContext<MediaSoupContextType | undefined>(
  undefined
);

// Helper functions
const getEnhancedTransportParams = (params: any) => ({
  ...params,
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceTransportPolicy: "all",
});

export const MediaSoupProvider = ({ children }: { children: ReactNode }) => {
  // State management
  const [state, setState] = useState<MediaSoupState>(defaultState);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const pendingConsumerTracksRef = useRef<QueuedTrack[]>([]);

  // Room management
  const leaveRoom = useCallback(() => {
    if (!state.isConnected) return;

    // Close all media objects
    state.consumers.forEach(({ consumer }) => consumer.close());
    if (state.producers.audio) state.producers.audio.close();
    if (state.producers.video) state.producers.video.close();
    if (state.sendTransport) state.sendTransport.close();
    if (state.recvTransport) state.recvTransport.close();

    // Stop all local tracks
    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => track.stop());
    }

    // Notify server
    state.socket?.emit("leaveRoom", {
      roomId: state.roomId,
      userId: state.userId,
    });

    setState((prev) => ({
      ...defaultState,
      socket: prev.socket,
      userId: prev.userId,
      roomId: prev.roomId,
    }));
  }, [state]);

  // Initialize socket connection
  useEffect(() => {
    const socket = connectSocket(getServerUrl());
    setState((prevState) => ({ ...prevState, socket }));
    return () => {
      if (state.isConnected) leaveRoom();
      socket.disconnect();
    };
  }, []);

  // Event handlers for mediasoup operations
  const handleRouterRtpCapabilities = useCallback(
    async (routerRtpCapabilities: any) => {
      await loadDevice(routerRtpCapabilities);
    },
    [state.socket]
  );

  const handleTransportCreated = useCallback(
    async (params: any) => {
      params.type === "send"
        ? await setupSendTransport(params)
        : await setupRecvTransport(params);
    },
    [state.device, state.socket]
  );

  const handleProducerClosed = useCallback(
    ({ producerId }: { producerId: string }) => {
      closeConsumer(producerId);
    },
    [state.socket]
  );

  const handleNewProducer = useCallback(
    async ({ producerId, producerUserId, kind }: QueuedTrack) => {
      if (!state.recvTransport || !state.device) {
        pendingConsumerTracksRef.current.push({
          producerId,
          producerUserId,
          kind,
        });
        return;
      }
      await consumeTrack(producerId, producerUserId, kind);
    },
    [state.device, state.recvTransport, state.socket]
  );

  const handleExistingProducers = useCallback(
    (producers: Array<QueuedTrack>) => {
      const otherProducers = producers.filter(
        ({ producerUserId }) => producerUserId !== state.userId
      );

      if (!state.recvTransport || !state.device) {
        pendingConsumerTracksRef.current = [
          ...pendingConsumerTracksRef.current,
          ...otherProducers,
        ];
        return;
      }

      otherProducers.forEach(({ producerId, producerUserId, kind }) => {
        consumeTrack(producerId, producerUserId, kind);
      });
    },
    [state.userId, state.device, state.recvTransport, state.socket]
  );

  // Process pending consumer tracks when recvTransport becomes available
  useEffect(() => {
    if (state.recvTransport && pendingConsumerTracksRef.current.length > 0) {
      pendingConsumerTracksRef.current.forEach(
        ({ producerId, producerUserId, kind }) => {
          consumeTrack(producerId, producerUserId, kind);
        }
      );
      pendingConsumerTracksRef.current = [];
    }
  }, [state.recvTransport]);

  // Socket event registration
  useEffect(() => {
    if (!state.socket) return;

    const socketEvents = {
      routerRtpCapabilities: handleRouterRtpCapabilities,
      transportCreated: handleTransportCreated,
      producerClosed: handleProducerClosed,
      newProducer: handleNewProducer,
      existingProducers: handleExistingProducers,
      participantJoined: ({ userId }: { userId: string }) => {
        setState((prevState) => {
          const newParticipants = new Map(prevState.participants);
          newParticipants.set(userId, { id: userId, consumers: {} });
          return { ...prevState, participants: newParticipants };
        });
      },
      participantLeft: ({ userId }: { userId: string }) => {
        removeParticipantVideo(userId);
        setState((prevState) => {
          const newParticipants = new Map(prevState.participants);
          newParticipants.delete(userId);
          return { ...prevState, participants: newParticipants };
        });
      },
    };

    // Remove existing listeners and add new ones
    Object.keys(socketEvents).forEach((event) => state.socket?.off(event));
    Object.entries(socketEvents).forEach(([event, handler]) => {
      state.socket?.on(event, handler as (...args: any[]) => void);
    });

    return () => {
      if (state.socket) {
        Object.keys(socketEvents).forEach((event) => state.socket?.off(event));
      }
    };
  }, [
    state.socket,
    state.device,
    state.userId,
    state.recvTransport,
    handleRouterRtpCapabilities,
    handleTransportCreated,
    handleProducerClosed,
    handleNewProducer,
    handleExistingProducers,
  ]);

  // Create transports when device is loaded
  useEffect(() => {
    if (
      state.device &&
      state.socket &&
      state.isConnected &&
      !state.recvTransport &&
      (!state.sendTransport || state.isSpectator)
    ) {
      // For spectator mode, only create receive transport
      if (state.isSpectator) {
        // Create receive transport only
        state.socket.emit("createWebRtcTransport", {
          forceTcp: false,
          iceTransportPolicy: "all",
          type: "recv",
          roomId: state.roomId,
          userId: state.userId,
          isSpectator: true,
        });
      } else {
        const transportOptions = {
          forceTcp: false,
          iceTransportPolicy: "all",
          additionalSettings: {
            iceServers: [
              {
                urls: [
                  "stun:stun.l.google.com:19302",
                  "stun:stun1.l.google.com:19302",
                ],
              },
            ],
          },
        };

        // Create send transport
        state.socket.emit("createWebRtcTransport", {
          ...transportOptions,
          type: "send",
          roomId: state.roomId,
          userId: state.userId,
        });

        // Create receive transport
        state.socket.emit("createWebRtcTransport", {
          ...transportOptions,
          type: "recv",
          roomId: state.roomId,
          userId: state.userId,
        });
      }
    }
  }, [
    state.device,
    state.socket,
    state.isConnected,
    state.roomId,
    state.userId,
    state.sendTransport,
    state.recvTransport,
    state.isSpectator,
  ]);

  // Join room and get media
  const joinRoom = async () => {
    try {
      if (!state.socket) {
        alert("Socket connection not established. Cannot join room.");
        return;
      }

      // Security and browser compatibility checks
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        alert("MediaDevices API requires a secure context. Please use HTTPS.");
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert(
          "Your browser doesn't support the MediaDevices API required for video calls."
        );
        return;
      }

      // Get media stream
      let localStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
      } catch (mediaError) {
        const errorName = (mediaError as Error).name;
        if (["NotAllowedError", "PermissionDeniedError"].includes(errorName)) {
          alert(
            "Camera and microphone access was denied. Please allow access to use this app."
          );
        } else if (errorName === "NotFoundError") {
          alert(
            "No camera or microphone found. Please connect these devices and try again."
          );
        } else {
          alert(
            `Error accessing camera or microphone: ${
              (mediaError as Error).message
            }`
          );
        }
        return;
      }

      setState((prevState) => ({
        ...prevState,
        localStream,
        isConnected: true,
      }));

      // Initialize connection with slight delay to ensure socket is ready
      setTimeout(() => {
        state.socket?.emit("getRouterRtpCapabilities", {
          roomId: state.roomId,
          userId: state.userId,
        });
      }, 300);
    } catch (error) {
      alert(`Failed to join room: ${(error as Error).message}`);
    }
  };

  // Join room as a spectator (watch only)
  const joinRoomAsSpectator = async () => {
    try {
      if (!state.socket) {
        alert("Socket connection not established. Cannot join room.");
        return;
      }

      // Set spectator mode
      setState((prevState) => ({
        ...prevState,
        isSpectator: true,
        isConnected: true,
      }));

      // Initialize connection with slight delay to ensure socket is ready
      setTimeout(() => {
        state.socket?.emit("getRouterRtpCapabilities", {
          roomId: state.roomId,
          userId: state.userId,
          isSpectator: true,
        });
      }, 300);
    } catch (error) {
      alert(`Failed to join as spectator: ${(error as Error).message}`);
    }
  };

  // MediaSoup device setup
  const loadDevice = async (routerRtpCapabilities: any) => {
    try {
      if (!state.socket) return;

      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities });
      setState((prevState) => ({ ...prevState, device }));
    } catch (error) {
      console.error("Error loading device:", error);
      alert("Failed to load MediaSoup device. Check console for details.");
    }
  };

  // Configure and setup send transport
  const setupSendTransport = async (params: any) => {
    try {
      if (!state.device) return;

      const transportParams = getEnhancedTransportParams(params);
      const sendTransport = state.device.createSendTransport(transportParams);

      // Handle transport events
      sendTransport.on(
        "connect",
        async (
          { dtlsParameters }: any,
          callback: () => void,
          errback: (err: Error) => void
        ) => {
          try {
            state.socket?.emit("connectWebRtcTransport", {
              transportId: sendTransport.id,
              dtlsParameters,
              roomId: state.roomId,
            });
            callback();
          } catch (error) {
            errback(error as Error);
          }
        }
      );

      sendTransport.on(
        "produce",
        async (
          { kind, rtpParameters }: any,
          callback: (producerInfo: { id: any; error?: string }) => void,
          errback: (err: Error) => void
        ) => {
          try {
            state.socket?.emit(
              "produce",
              {
                transportId: sendTransport.id,
                kind,
                rtpParameters,
                roomId: state.roomId,
                userId: state.userId,
              },
              (response: { id?: any; error?: string }) => {
                if (response.error) {
                  errback(new Error(response.error));
                  return;
                }
                callback({ id: response.id });
              }
            );
          } catch (error) {
            errback(error as Error);
          }
        }
      );

      // Handle connection state changes
      sendTransport.on("connectionstatechange", (connectionState) => {
        if (connectionState === "failed" || connectionState === "closed") {
          if (connectionState === "failed" && state.localStream) {
            // Clear previous restart timer
            if ((window as any).sendTransportRestartTimer) {
              clearTimeout((window as any).sendTransportRestartTimer);
            }

            // Try to recover with more aggressive options
            (window as any).sendTransportRestartTimer = setTimeout(() => {
              if (state.device && state.socket && state.isConnected) {
                state.socket.emit("createWebRtcTransport", {
                  forceTcp: true,
                  type: "send",
                  roomId: state.roomId,
                  userId: state.userId,
                  iceTransportPolicy: "relay",
                  additionalSettings: {
                    iceServers: [
                      {
                        urls: [
                          "stun:stun.l.google.com:19302",
                          "stun:stun1.l.google.com:19302",
                        ],
                      },
                    ],
                  },
                });
              }
            }, 2000);
          }
        } else if (connectionState === "connected") {
          // Clear restart timer if now connected
          if ((window as any).sendTransportRestartTimer) {
            clearTimeout((window as any).sendTransportRestartTimer);
            (window as any).sendTransportRestartTimer = null;
          }
        }
      });

      setState((prevState) => ({ ...prevState, sendTransport }));
      await publishLocalTracks(sendTransport);
    } catch (error) {
      console.error("Error setting up send transport:", error);
    }
  };

  // Configure and setup receive transport
  const setupRecvTransport = async (params: any) => {
    try {
      if (!state.device) return;

      const transportParams = getEnhancedTransportParams(params);
      const recvTransport = state.device.createRecvTransport(transportParams);

      // Handle transport events
      recvTransport.on(
        "connect",
        async (
          { dtlsParameters }: any,
          callback: () => void,
          errback: (err: Error) => void
        ) => {
          try {
            state.socket?.emit("connectWebRtcTransport", {
              transportId: recvTransport.id,
              dtlsParameters,
              roomId: state.roomId,
            });
            callback();
          } catch (error) {
            errback(error as Error);
          }
        }
      );

      // Handle connection state changes
      recvTransport.on("connectionstatechange", (connectionState) => {
        if (connectionState === "failed") {
          // Clear previous restart timer
          if ((window as any).recvTransportRestartTimer) {
            clearTimeout((window as any).recvTransportRestartTimer);
          }

          // Try to recover with more aggressive options
          (window as any).recvTransportRestartTimer = setTimeout(() => {
            if (state.device && state.socket && state.isConnected) {
              state.socket.emit("createWebRtcTransport", {
                forceTcp: true,
                type: "recv",
                roomId: state.roomId,
                userId: state.userId,
                iceTransportPolicy: "relay",
                additionalSettings: {
                  iceServers: [
                    {
                      urls: [
                        "stun:stun.l.google.com:19302",
                        "stun:stun1.l.google.com:19302",
                      ],
                    },
                  ],
                },
              });
            }
          }, 2500);
        } else if (connectionState === "connected") {
          // Clear restart timer if now connected
          if ((window as any).recvTransportRestartTimer) {
            clearTimeout((window as any).recvTransportRestartTimer);
            (window as any).recvTransportRestartTimer = null;
          }
        }
      });

      setState((prevState) => ({ ...prevState, recvTransport }));

      // Request existing producers
      state.socket?.emit("getProducers", {
        roomId: state.roomId,
        userId: state.userId,
      });
    } catch (error) {
      console.error("Error setting up receive transport:", error);
    }
  };

  // Publish local media tracks
  const publishLocalTracks = async (transportToUse?: any) => {
    try {
      if (!state.localStream) return;

      const transport = transportToUse || state.sendTransport;
      if (!transport) return;

      const audioTrack = state.localStream.getAudioTracks()[0];
      const videoTrack = state.localStream.getVideoTracks()[0];
      const newProducers = { ...state.producers };

      // Produce audio if available and enabled
      if (audioTrack && isAudioEnabled) {
        newProducers.audio = await transport.produce({
          track: audioTrack,
          codecOptions: { opusStereo: true, opusDtx: true },
        });
      }

      // Produce video if available and enabled
      if (videoTrack && isVideoEnabled) {
        newProducers.video = await transport.produce({
          track: videoTrack,
          encodings: [
            { maxBitrate: 100000 },
            { maxBitrate: 300000 },
            { maxBitrate: 900000 },
          ],
          codecOptions: { videoGoogleStartBitrate: 1000 },
        });
      }

      setState((prevState) => ({ ...prevState, producers: newProducers }));
    } catch (error) {
      console.error("Error publishing local tracks:", error);
    }
  };

  // Consume remote media tracks
  const consumeTrack = async (
    producerId: string,
    producerUserId: string,
    kind: string
  ) => {
    try {
      // Skip consuming own tracks
      if (producerUserId === state.userId) return;

      // Queue track if transport not ready
      if (!state.recvTransport || !state.device) {
        pendingConsumerTracksRef.current.push({
          producerId,
          producerUserId,
          kind,
        });
        return;
      }

      // Ensure participant exists
      setState((prevState) => {
        const newParticipants = new Map(prevState.participants);
        if (!newParticipants.has(producerUserId)) {
          newParticipants.set(producerUserId, {
            id: producerUserId,
            consumers: {},
          });
        }
        return { ...prevState, participants: newParticipants };
      });

      // Request consumer from server
      state.socket?.emit(
        "consume",
        {
          rtpCapabilities: state.device.rtpCapabilities,
          remoteProducerId: producerId,
          transportId: state.recvTransport.id,
          roomId: state.roomId,
        },
        async (consumerParams: any) => {
          if (consumerParams.error) return;

          const {
            id,
            producerId: actualProducerId,
            kind: actualKind,
            rtpParameters,
          } = consumerParams;

          try {
            // Create consumer and add to state
            const consumer = await state.recvTransport.consume({
              id,
              producerId: actualProducerId,
              kind: actualKind,
              rtpParameters,
            });

            if (!consumer.track) {
              consumer.close();
              return;
            }

            // Add consumer to state
            setState((prevState) => {
              const newConsumers = [
                ...prevState.consumers,
                {
                  id: consumer.id,
                  producerId: actualProducerId,
                  consumer,
                  userId: producerUserId,
                  kind: actualKind,
                },
              ];

              // Update participant record
              const newParticipants = new Map(prevState.participants);
              const participant = newParticipants.get(producerUserId) || {
                id: producerUserId,
                consumers: {},
              };
              participant.consumers[actualKind] = consumer;
              newParticipants.set(producerUserId, participant);

              return {
                ...prevState,
                consumers: newConsumers,
                participants: newParticipants,
              };
            });

            // Resume the consumer
            state.socket?.emit("resumeConsumer", {
              consumerId: consumer.id,
              roomId: state.roomId,
            });
          } catch (error) {
            console.error(
              `Failed to create consumer for ${producerUserId}:`,
              error
            );
          }
        }
      );
    } catch (error) {
      console.error("Error consuming track:", error);
    }
  };

  // Close specific consumer
  const closeConsumer = (producerId: string) => {
    const consumerIndex = state.consumers.findIndex(
      (c) => c.producerId === producerId
    );
    if (consumerIndex === -1) return;

    const { consumer } = state.consumers[consumerIndex];
    consumer.close();

    setState((prevState) => {
      const newConsumers = [...prevState.consumers];
      newConsumers.splice(consumerIndex, 1);
      return { ...prevState, consumers: newConsumers };
    });
  };

  // Remove all consumers for a participant
  const removeParticipantVideo = (userId: string) => {
    const participantConsumers = state.consumers.filter(
      (c) => c.userId === userId
    );

    participantConsumers.forEach(({ consumer }) => {
      try {
        if (consumer && typeof consumer.close === "function") {
          consumer.close();
        }
      } catch (error) {
        console.error("Error closing consumer:", error);
      }
    });

    setState((prevState) => ({
      ...prevState,
      consumers: prevState.consumers.filter((c) => c.userId !== userId),
    }));
  };

  // Media control functions
  const toggleAudio = () => {
    if (!state.localStream) return;

    const audioTracks = state.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const enabled = !audioTracks[0].enabled;
      audioTracks.forEach((track) => {
        track.enabled = enabled;
      });
      setIsAudioEnabled(enabled);
    }
  };

  const toggleVideo = () => {
    if (!state.localStream) return;

    const videoTracks = state.localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const enabled = !videoTracks[0].enabled;
      videoTracks.forEach((track) => {
        track.enabled = enabled;
      });
      setIsVideoEnabled(enabled);
    }
  };

  return (
    <MediaSoupContext.Provider
      value={{
        state,
        joinRoom,
        leaveRoom,
        toggleAudio,
        toggleVideo,
        isAudioEnabled,
        isVideoEnabled,
        joinRoomAsSpectator,
      }}
    >
      {children}
    </MediaSoupContext.Provider>
  );
};

export const useMediaSoup = () => {
  const context = useContext(MediaSoupContext);
  if (context === undefined) {
    throw new Error("useMediaSoup must be used within a MediaSoupProvider");
  }
  return context;
};

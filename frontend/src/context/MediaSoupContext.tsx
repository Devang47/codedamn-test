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

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.hostname;
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT || "3000";

const getServerUrl = () => {
  return `http://${SERVER_URL}:${SERVER_PORT}`;
};

type QueuedTrack = {
  producerId: string;
  producerUserId: string;
  kind: string;
};

type Participant = {
  id: string;
  consumers: Record<string, any>;
};

type MediaSoupState = {
  device: mediasoupClient.Device | null;
  socket: Socket | null;
  roomId: string;
  userId: string;
  producers: {
    audio: any | null;
    video: any | null;
  };
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
};

type MediaSoupContextType = {
  state: MediaSoupState;
  joinRoom: () => Promise<void>;
  leaveRoom: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
};

const defaultState: MediaSoupState = {
  device: null,
  socket: null,
  roomId: "main-room",
  userId: `user-${Math.floor(Math.random() * 1000000)}`,
  producers: {
    audio: null,
    video: null,
  },
  consumers: [],
  sendTransport: null,
  recvTransport: null,
  localStream: null,
  isConnected: false,
  participants: new Map(),
};

const MediaSoupContext = createContext<MediaSoupContextType | undefined>(
  undefined
);

export const MediaSoupProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<MediaSoupState>(defaultState);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const pendingConsumerTracksRef = useRef<QueuedTrack[]>([]);

  const leaveRoom = useCallback(() => {
    if (!state.isConnected) return;

    state.consumers.forEach(({ consumer }) => consumer.close());

    if (state.producers.audio) {
      state.producers.audio.close();
    }
    if (state.producers.video) {
      state.producers.video.close();
    }

    if (state.sendTransport) {
      state.sendTransport.close();
    }
    if (state.recvTransport) {
      state.recvTransport.close();
    }

    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => track.stop());
    }

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

  useEffect(() => {
    const serverUrl = getServerUrl();
    console.log(`Connecting to server at: ${serverUrl}`);
    const socket = connectSocket(serverUrl);
    setState((prevState) => ({ ...prevState, socket }));

    return () => {
      if (state.isConnected) {
        leaveRoom();
      }
      socket.disconnect();
    };
  }, []);

  const handleRouterRtpCapabilities = useCallback(
    async (routerRtpCapabilities: any) => {
      console.log(
        "routerRtpCapabilities received, current socket:",
        state.socket
      );
      await loadDevice(routerRtpCapabilities);
    },
    [state.socket]
  );

  const handleTransportCreated = useCallback(
    async (params: any) => {
      console.log(
        "transportCreated event received:",
        params,
        "Current device:",
        state.device
      );

      if (params.type === "send") {
        await setupSendTransport(params);
      } else if (params.type === "recv") {
        await setupRecvTransport(params);
      }
    },
    [state.device, state.socket]
  );

  useEffect(() => {
    if (state.recvTransport && pendingConsumerTracksRef.current.length > 0) {
      console.log(
        `Processing ${pendingConsumerTracksRef.current.length} pending consumer tracks now that recvTransport is available`
      );

      pendingConsumerTracksRef.current.forEach(
        ({ producerId, producerUserId, kind }) => {
          consumeTrack(producerId, producerUserId, kind);
        }
      );

      pendingConsumerTracksRef.current = [];
    }
  }, [state.recvTransport]);

  const handleProducerClosed = useCallback(
    ({ producerId }: { producerId: string }) => {
      closeConsumer(producerId);
    },
    [state.socket]
  );

  const handleNewProducer = useCallback(
    async ({
      producerId,
      producerUserId,
      kind,
    }: {
      producerId: string;
      producerUserId: string;
      kind: string;
    }) => {
      console.log(
        `Received newProducer event for user ${producerUserId}, kind: ${kind}`
      );

      if (!state.recvTransport || !state.device) {
        console.log(
          `Queueing consumption of ${kind} track from ${producerUserId} until recvTransport is ready`
        );
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
    (
      producers: Array<{
        producerId: string;
        producerUserId: string;
        kind: string;
      }>
    ) => {
      console.log("Received existingProducers:", producers);

      const otherProducers = producers.filter(
        ({ producerUserId }) => producerUserId !== state.userId
      );

      if (!state.recvTransport || !state.device) {
        console.log(
          `Queueing consumption of ${otherProducers.length} existing tracks until recvTransport is ready`
        );
        pendingConsumerTracksRef.current = [
          ...pendingConsumerTracksRef.current,
          ...otherProducers,
        ];
        return;
      }

      for (const { producerId, producerUserId, kind } of otherProducers) {
        console.log(
          `Consuming existing producer: ${producerId} from user ${producerUserId}, kind: ${kind}`
        );
        consumeTrack(producerId, producerUserId, kind);
      }
    },
    [state.userId, state.device, state.recvTransport, state.socket]
  );

  useEffect(() => {
    if (!state.socket) return;

    state.socket.off("routerRtpCapabilities");
    state.socket.off("transportCreated");
    state.socket.off("producerClosed");
    state.socket.off("newProducer");
    state.socket.off("existingProducers");
    state.socket.off("participantJoined");
    state.socket.off("participantLeft");

    state.socket.on("routerRtpCapabilities", handleRouterRtpCapabilities);
    state.socket.on("transportCreated", handleTransportCreated);
    state.socket.on("producerClosed", handleProducerClosed);
    state.socket.on("newProducer", handleNewProducer);
    state.socket.on("existingProducers", handleExistingProducers);

    state.socket.on("participantJoined", ({ userId }) => {
      console.log(`Participant joined: ${userId}`);
      setState((prevState) => {
        const newParticipants = new Map(prevState.participants);
        newParticipants.set(userId, { id: userId, consumers: {} });
        return { ...prevState, participants: newParticipants };
      });
    });

    state.socket.on("participantLeft", ({ userId }) => {
      console.log(`Participant left: ${userId}`);

      // First close all consumers for this participant
      removeParticipantVideo(userId);

      // Then remove the participant from the state
      setState((prevState) => {
        const newParticipants = new Map(prevState.participants);
        newParticipants.delete(userId);
        return { ...prevState, participants: newParticipants };
      });
    });

    return () => {
      if (state.socket) {
        state.socket.off("routerRtpCapabilities", handleRouterRtpCapabilities);
        state.socket.off("transportCreated", handleTransportCreated);
        state.socket.off("producerClosed", handleProducerClosed);
        state.socket.off("newProducer", handleNewProducer);
        state.socket.off("existingProducers", handleExistingProducers);
        state.socket.off("participantJoined");
        state.socket.off("participantLeft");
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

  useEffect(() => {
    if (
      state.device &&
      state.socket &&
      state.isConnected &&
      !state.sendTransport &&
      !state.recvTransport
    ) {
      console.log(
        "useEffect [state.device]: Device is loaded and transports are not yet created. Emitting createWebRtcTransport."
      );

      // Configure transports to use TURN servers when direct connections fail
      const transportOptions = {
        forceTcp: false,
        iceTransportPolicy: "all", // Try all connection methods
        additionalSettings: {
          // Add TURN server configuration - using free STUN servers for testing
          // In production, you should use your own TURN servers
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

      state.socket.emit("createWebRtcTransport", {
        ...transportOptions,
        type: "send",
        roomId: state.roomId,
        userId: state.userId,
      });
      console.log(
        "useEffect [state.device]: Emitted createWebRtcTransport for send transport."
      );

      state.socket.emit("createWebRtcTransport", {
        ...transportOptions,
        type: "recv",
        roomId: state.roomId,
        userId: state.userId,
      });
      console.log(
        "useEffect [state.device]: Emitted createWebRtcTransport for recv transport."
      );
    }
  }, [
    state.device,
    state.socket,
    state.isConnected,
    state.roomId,
    state.userId,
    state.sendTransport,
    state.recvTransport,
  ]);

  useEffect(() => {
    if (state.isConnected) {
      console.log("MediaSoup State:", {
        roomId: state.roomId,
        userId: state.userId,
        isConnected: state.isConnected,
        deviceLoaded: !!state.device,
        sendTransport: !!state.sendTransport,
        recvTransport: !!state.recvTransport,
        localStream: !!state.localStream,
        producers: {
          audio: !!state.producers.audio,
          video: !!state.producers.video,
        },
        consumers: state.consumers.length,
        participants: Array.from(state.participants.entries()).map(
          ([id, p]) => ({
            id,
            hasVideo: !!p.consumers["video"],
            hasAudio: !!p.consumers["audio"],
          })
        ),
      });
    }
  }, [state.isConnected, state.consumers, state.participants]);

  const joinRoom = async () => {
    try {
      if (!state.socket) {
        console.error("joinRoom: Socket not available!");
        alert("Socket connection not established. Cannot join room.");
        return;
      }

      // Check if running in secure context
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        alert("MediaDevices API requires a secure context. Please use HTTPS.");
        console.error("MediaDevices API requires secure context (HTTPS)");
        return;
      }

      // Check if MediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg =
          "Your browser doesn't support the MediaDevices API required for video calls.";
        alert(msg);
        console.error("MediaDevices API not available", {
          mediaDevices: !!navigator.mediaDevices,
          getUserMedia:
            navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia,
        });
        return;
      }

      console.log("Requesting camera and microphone access...");

      // Request media access with better error handling
      let localStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        console.log("Camera and microphone access granted", localStream);
      } catch (mediaError) {
        if (
          (mediaError as Error).name === "NotAllowedError" ||
          (mediaError as Error).name === "PermissionDeniedError"
        ) {
          alert(
            "Camera and microphone access was denied. Please allow access to use this app."
          );
          console.error("Media permission denied:", mediaError);
          return;
        } else if ((mediaError as Error).name === "NotFoundError") {
          alert(
            "No camera or microphone found. Please connect these devices and try again."
          );
          console.error("Media devices not found:", mediaError);
          return;
        } else {
          alert(
            `Error accessing camera or microphone: ${
              (mediaError as Error).message
            }`
          );
          console.error("Media access error:", mediaError);
          return;
        }
      }

      setState((prevState) => ({
        ...prevState,
        localStream,
        isConnected: true,
      }));

      setTimeout(() => {
        if (state.socket) {
          console.log(
            "Emitting getRouterRtpCapabilities with socket:",
            state.socket
          );
          state.socket.emit("getRouterRtpCapabilities", {
            roomId: state.roomId,
            userId: state.userId,
          });
        } else {
          console.error("Socket still not available after delay");
        }
      }, 300);
    } catch (error) {
      console.error("Error joining room:", error);
      alert(`Failed to join room: ${(error as Error).message}`);
    }
  };

  const loadDevice = async (routerRtpCapabilities: any) => {
    try {
      console.log("loadDevice called with socket:", state.socket);
      if (!state.socket) {
        console.error("loadDevice: Socket not available!");
        alert("Socket connection not established. Cannot load device.");
        return;
      }

      const device = new mediasoupClient.Device();
      console.log("loadDevice: MediaSoup device created:", device);

      await device.load({ routerRtpCapabilities });
      console.log(
        "loadDevice: Device loaded with RtpCapabilities:",
        device.rtpCapabilities
      );

      setState((prevState) => ({ ...prevState, device }));
      console.log(
        "loadDevice: Device set in state. Transports will be created by useEffect."
      );
    } catch (error) {
      console.error("Error loading device:", error);
      alert("Failed to load MediaSoup device. Check console for details.");
    }
  };

  const setupSendTransport = async (params: any) => {
    try {
      if (!state.device) {
        console.error("setupSendTransport: Device not available!");
        return;
      }
      console.log(
        "setupSendTransport: Creating send transport with params:",
        params
      );

      // Enhanced ICE configuration with TURN servers
      const transportParams = {
        ...params,
        iceServers: [
          {
            urls: [
              "stun:stun.l.google.com:19302",
              "stun:stun1.l.google.com:19302",
            ],
          },
          // Add a TURN server - replace with your own TURN server in production
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
        ],
        iceTransportPolicy: "all",
      };

      const sendTransport = state.device.createSendTransport(transportParams);
      console.log("setupSendTransport: Send transport created:", sendTransport);

      sendTransport.on(
        "connect",
        async (
          { dtlsParameters }: any,
          callback: () => void,
          errback: (err: Error) => void
        ) => {
          try {
            console.log(
              "Send transport connect event with dtlsParameters:",
              dtlsParameters
            );

            state.socket?.emit("connectWebRtcTransport", {
              transportId: sendTransport.id,
              dtlsParameters,
              roomId: state.roomId,
            });

            callback();
          } catch (error) {
            console.error("Error in send transport connect event:", error);
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
            console.log(`Attempting to produce ${kind} track.`);
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
                  console.error(
                    `Error from server on produce ${kind}:`,
                    response.error
                  );
                  errback(new Error(response.error));
                  return;
                }
                console.log(
                  `Successfully produced ${kind} track. Producer ID: ${response.id}`
                );
                callback({ id: response.id });
              }
            );
          } catch (error) {
            console.error(`Error in produce event for ${kind}:`, error);
            errback(error as Error);
          }
        }
      );

      sendTransport.on("connectionstatechange", (connectionState) => {
        console.log(
          `Send transport connection state changed to: ${connectionState}`,
          {
            iceState: sendTransport.iceState,
            dtlsState: sendTransport.dtlsState,
            iceSelectedTuple: sendTransport.iceSelectedTuple,
          }
        );
        if (connectionState === "failed" || connectionState === "closed") {
          console.error(
            "Send transport connection failed or closed. Details:",
            {
              iceState: (sendTransport as any).iceState,
              dtlsState: (sendTransport as any).dtlsState,
              iceSelectedTuple: (sendTransport as any).iceSelectedTuple,
            }
          );

          if (connectionState === "failed" && state.localStream) {
            console.log("Attempting to recover failed connection...");

            // Clear any previous restart timers
            if ((window as any).sendTransportRestartTimer) {
              clearTimeout((window as any).sendTransportRestartTimer);
            }

            // Add delay before retry to allow network conditions to change
            (window as any).sendTransportRestartTimer = setTimeout(() => {
              if (state.device && state.socket && state.isConnected) {
                console.log("Requesting new send transport after failure");

                // Try with more aggressive options for the retry
                state.socket.emit("createWebRtcTransport", {
                  forceTcp: true, // Force TCP which works better in restricted networks
                  type: "send",
                  roomId: state.roomId,
                  userId: state.userId,
                  iceTransportPolicy: "relay", // Force usage of TURN servers
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
          console.log("Send transport successfully connected!");

          // Clear any restart timers if we're now connected
          if ((window as any).sendTransportRestartTimer) {
            clearTimeout((window as any).sendTransportRestartTimer);
            (window as any).sendTransportRestartTimer = null;
          }
        }
      });

      setState((prevState) => ({ ...prevState, sendTransport }));
      console.log("setupSendTransport: Send transport set in state.");

      await publishLocalTracks(sendTransport);
    } catch (error) {
      console.error("Error setting up send transport:", error);
    }
  };

  const publishLocalTracks = async (transportToUse?: any) => {
    try {
      if (!state.localStream) {
        console.error("publishLocalTracks: Local stream not available.");
        return;
      }

      const transport = transportToUse || state.sendTransport;

      if (!transport) {
        console.error("publishLocalTracks: Send transport not available.");
        return;
      }
      console.log(
        "publishLocalTracks: Attempting to publish local tracks with transport:",
        transport.id
      );

      const audioTrack = state.localStream.getAudioTracks()[0];
      const videoTrack = state.localStream.getVideoTracks()[0];
      const newProducers = { ...state.producers };

      if (audioTrack && isAudioEnabled) {
        console.log("publishLocalTracks: Producing audio track.");
        newProducers.audio = await transport.produce({
          track: audioTrack,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
          },
        });
        console.log(
          "publishLocalTracks: Audio producer created:",
          newProducers.audio
        );
      } else {
        console.log(
          "publishLocalTracks: Audio track not available or not enabled."
        );
      }

      if (videoTrack && isVideoEnabled) {
        console.log("publishLocalTracks: Producing video track.");
        newProducers.video = await transport.produce({
          track: videoTrack,
          encodings: [
            { maxBitrate: 100000 },
            { maxBitrate: 300000 },
            { maxBitrate: 900000 },
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });
        console.log(
          "publishLocalTracks: Video producer created:",
          newProducers.video
        );
      } else {
        console.log(
          "publishLocalTracks: Video track not available or not enabled."
        );
      }

      setState((prevState) => ({ ...prevState, producers: newProducers }));
      console.log("publishLocalTracks: Producers set in state:", newProducers);
    } catch (error) {
      console.error("Error publishing local tracks:", error);
    }
  };

  const setupRecvTransport = async (params: any) => {
    try {
      if (!state.device) {
        console.error("setupRecvTransport: Device not available!");
        return;
      }
      console.log(
        "setupRecvTransport: Creating receive transport with params:",
        params
      );

      // Enhanced ICE configuration with TURN servers
      const transportParams = {
        ...params,
        iceServers: [
          {
            urls: [
              "stun:stun.l.google.com:19302",
              "stun:stun1.l.google.com:19302",
            ],
          },
          // Add a TURN server - replace with your own TURN server in production
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
        ],
        iceTransportPolicy: "all",
      };

      const recvTransport = state.device.createRecvTransport(transportParams);
      console.log(
        "setupRecvTransport: Receive transport created:",
        recvTransport
      );

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

      recvTransport.on("connectionstatechange", (connectionState) => {
        console.log(
          `Receive transport connection state changed to: ${connectionState}`,
          {
            iceState: recvTransport.iceState,
            dtlsState: recvTransport.dtlsState,
            iceSelectedTuple: recvTransport.iceSelectedTuple,
          }
        );
        if (connectionState === "failed" || connectionState === "closed") {
          console.error("Receive transport connection failed or closed.", {
            iceState: (recvTransport as any).iceState,
            dtlsState: (recvTransport as any).dtlsState,
            iceSelectedTuple: (recvTransport as any).iceSelectedTuple,
          });

          // Implement recovery for receive transport too
          if (connectionState === "failed") {
            console.log("Attempting to recover failed receive connection...");

            // Clear any previous restart timers
            if ((window as any).recvTransportRestartTimer) {
              clearTimeout((window as any).recvTransportRestartTimer);
            }

            (window as any).recvTransportRestartTimer = setTimeout(() => {
              if (state.device && state.socket && state.isConnected) {
                console.log("Requesting new receive transport after failure");
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
            }, 2500); // Slight delay after send transport retry
          }
        } else if (connectionState === "connected") {
          console.log("Receive transport successfully connected!");

          // Clear any restart timers if we're now connected
          if ((window as any).recvTransportRestartTimer) {
            clearTimeout((window as any).recvTransportRestartTimer);
            (window as any).recvTransportRestartTimer = null;
          }
        }
      });

      setState((prevState) => ({ ...prevState, recvTransport }));
      console.log("setupRecvTransport: Receive transport set in state.");

      console.log("Requesting existing producers from server...");
      state.socket?.emit("getProducers", {
        roomId: state.roomId,
        userId: state.userId,
      });
    } catch (error) {
      console.error("Error setting up receive transport:", error);
    }
  };

  const consumeTrack = async (
    producerId: string,
    producerUserId: string,
    kind: string
  ) => {
    try {
      if (producerUserId === state.userId) {
        console.log(
          `Skipping consumption of own ${kind} track from producer ${producerId}`
        );
        return;
      }

      if (!state.recvTransport || !state.device) {
        console.warn("Cannot consume track - missing transport or device");
        pendingConsumerTracksRef.current.push({
          producerId,
          producerUserId,
          kind,
        });
        console.log(
          `Queued ${kind} track from ${producerUserId} for later consumption`
        );
        return;
      }

      console.log(
        `Attempting to consume ${kind} track from user ${producerUserId} (producer: ${producerId})`
      );

      setState((prevState) => {
        const newParticipants = new Map(prevState.participants);
        if (!newParticipants.has(producerUserId)) {
          console.log(`Adding new participant for ${producerUserId}`);
          newParticipants.set(producerUserId, {
            id: producerUserId,
            consumers: {},
          });
        }
        return { ...prevState, participants: newParticipants };
      });

      state.socket?.emit(
        "consume",
        {
          rtpCapabilities: state.device.rtpCapabilities,
          remoteProducerId: producerId,
          transportId: state.recvTransport.id,
          roomId: state.roomId,
        },
        async (consumerParams: any) => {
          if (consumerParams.error) {
            console.error(
              `Error from server on consume for producer ${producerId}:`,
              consumerParams.error
            );
            return;
          }

          const {
            id,
            producerId: actualProducerId,
            kind: actualKind,
            rtpParameters,
          } = consumerParams;

          try {
            console.log(
              `Received consume callback for ${actualKind} track from ${producerUserId}. Consumer params:`,
              consumerParams
            );

            const consumer = await state.recvTransport.consume({
              id,
              producerId: actualProducerId,
              kind: actualKind,
              rtpParameters,
            });

            console.log(
              `Created Mediasoup consumer for ${actualKind} track:`,
              consumer
            );
            if (!consumer.track) {
              console.error("Consumer track is null or undefined!", consumer);
              consumer.close();
              return;
            }

            const newConsumer = {
              id: consumer.id,
              producerId: actualProducerId,
              consumer,
              userId: producerUserId,
              kind: actualKind,
            };

            setState((prevState) => {
              const newConsumers = [...prevState.consumers, newConsumer];

              const newParticipants = new Map(prevState.participants);
              const participant = newParticipants.get(producerUserId) || {
                id: producerUserId,
                consumers: {},
              };

              participant.consumers[actualKind] = consumer;
              newParticipants.set(producerUserId, participant);

              console.log(
                `Updated participant ${producerUserId} with ${actualKind} consumer`
              );
              console.log(
                "New participants map:",
                Array.from(newParticipants.entries())
              );

              return {
                ...prevState,
                consumers: newConsumers,
                participants: newParticipants,
              };
            });

            state.socket?.emit("resumeConsumer", {
              consumerId: consumer.id,
              roomId: state.roomId,
            });

            console.log(
              `Resumed consumer ${consumer.id} for track ${consumer.track.id}`
            );
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

  const closeConsumer = (producerId: string) => {
    const consumerIndex = state.consumers.findIndex(
      (c) => c.producerId === producerId
    );
    if (consumerIndex === -1) {
      console.warn(
        `Consumer for producerId ${producerId} not found, cannot close.`
      );
      return;
    }

    const { consumer, userId, kind } = state.consumers[consumerIndex];

    consumer.close();

    setState((prevState) => {
      const newConsumers = [...prevState.consumers];
      newConsumers.splice(consumerIndex, 1);
      return { ...prevState, consumers: newConsumers };
    });
  };

  const removeParticipantVideo = (userId: string) => {
    console.log(
      `Removing participant ${userId} and closing all associated consumers`
    );

    // Find all consumers that belong to this participant
    const participantConsumers = state.consumers.filter(
      (c) => c.userId === userId
    );

    if (participantConsumers.length === 0) {
      console.log(`No consumers found for participant ${userId}`);
      return;
    }

    console.log(
      `Closing ${participantConsumers.length} consumers for participant ${userId}`
    );

    // Close each consumer
    participantConsumers.forEach(({ consumer, id }) => {
      try {
        if (consumer && typeof consumer.close === "function") {
          consumer.close();
          console.log(`Closed consumer ${id} for participant ${userId}`);
        }
      } catch (error) {
        console.error(`Error closing consumer ${id}:`, error);
      }
    });

    // Remove the consumers from state
    setState((prevState) => {
      const newConsumers = prevState.consumers.filter(
        (c) => c.userId !== userId
      );
      return { ...prevState, consumers: newConsumers };
    });
  };

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

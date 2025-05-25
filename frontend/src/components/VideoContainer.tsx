import { useState, useRef, useEffect } from "react";
import { useMediaSoup } from "../context/MediaSoupContext";
import RemoteVideo from "./RemoteVideo";

interface VideoContainerProps {
  spectatorMode?: boolean;
}

function VideoContainer({ spectatorMode = false }: VideoContainerProps) {
  const { state, isAudioEnabled, isVideoEnabled } = useMediaSoup();
  const [remoteParticipants, setRemoteParticipants] = useState<string[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Update local video when stream changes
  useEffect(() => {
    if (!spectatorMode && localVideoRef.current && state.localStream) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream, spectatorMode]);

  // Update remote participants list whenever participants or consumers change
  useEffect(() => {
    console.log("Participants updated:", Array.from(state.participants.keys()));
    console.log("Consumers updated:", state.consumers);

    // Extract all unique participant IDs from consumers
    const participantIds = Array.from(
      new Set(
        state.consumers
          .filter((consumer) => consumer.kind === "video")
          .map((consumer) => consumer.userId)
      )
    );

    setRemoteParticipants(participantIds);
  }, [state.participants, state.consumers]);

  // Create remote video elements
  const renderRemoteVideos = () => {
    if (remoteParticipants.length === 0) {
      return (
        <div className="no-participants">
          Waiting for participants to join...
        </div>
      );
    }

    return remoteParticipants.map((userId) => {
      // Find video consumer for this participant
      const videoConsumer = state.consumers.find(
        (c) => c.userId === userId && c.kind === "video"
      );

      // If we don't have a video consumer for this participant yet, show a placeholder
      if (!videoConsumer) {
        return (
          <div key={userId} className="video-item placeholder">
            <div className="placeholder-content">
              <div className="placeholder-icon">👤</div>
              <div className="user-label">User {userId.split("-")[1]}</div>
              <div className="placeholder-text">Connecting...</div>
            </div>
          </div>
        );
      }

      return (
        <RemoteVideo
          key={userId}
          userId={userId}
          consumer={videoConsumer.consumer}
        />
      );
    });
  };

  return (
    <div id="videoContainer" className="video-container">
      {/* Only show local video if not in spectator mode */}
      {!spectatorMode && (
        <div className="video-item">
          <video
            ref={localVideoRef}
            id="localVideo"
            autoPlay
            muted
            playsInline
          ></video>
          <div className="user-label">You ({state.userId})</div>
          <div className="status-indicators">
            <div className={`indicator audio ${isAudioEnabled ? "on" : "off"}`}>
              {isAudioEnabled ? "🎤" : "🔇"}
            </div>
            <div className={`indicator video ${isVideoEnabled ? "on" : "off"}`}>
              {isVideoEnabled ? "📹" : "🚫"}
            </div>
          </div>
        </div>
      )}

      {/* Remote videos */}
      {renderRemoteVideos()}
    </div>
  );
}

export default VideoContainer;

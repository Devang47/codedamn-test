import { useEffect, useRef, useState } from "react";
import "./VideoContainer.css";
import { useMediaSoup } from "../context/MediaSoupContext";

// SVG icons for status indicators
const MicIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
  </svg>
);

const MicOffIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 3.27 2z" />
  </svg>
);

const VideoIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
  </svg>
);

const VideoOffIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" />
  </svg>
);

const VideoContainer = () => {
  const { state, isAudioEnabled, isVideoEnabled } = useMediaSoup();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<string[]>([]);

  // Set local video stream when it becomes available
  useEffect(() => {
    if (localVideoRef.current && state.localStream) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream]);

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

  console.log("Remote participants:", remoteParticipants);

  return (
    <div id="videoContainer" className="video-container">
      {/* Local video */}
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
          <div className="indicator">
            {isAudioEnabled ? <MicIcon /> : <MicOffIcon />}
          </div>
          <div className="indicator">
            {isVideoEnabled ? <VideoIcon /> : <VideoOffIcon />}
          </div>
        </div>
      </div>

      {/* Remote videos */}
      {renderRemoteVideos()}
    </div>
  );
};

// Component for remote video rendering
interface RemoteVideoProps {
  userId: string;
  consumer: any;
}

const RemoteVideo = ({ userId, consumer }: RemoteVideoProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !consumer || !consumer.track) {
      console.error("Cannot setup remote video - missing elements", {
        videoRef: !!videoRef.current,
        consumer: !!consumer,
        track: consumer && !!consumer.track,
      });
      return;
    }

    try {
      console.log(`Setting up video for ${userId} with track:`, consumer.track);
      const stream = new MediaStream([consumer.track]);
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current
          ?.play()
          .then(() => setIsVideoLoaded(true))
          .catch((e) => console.error("Failed to play remote video:", e));
      };
    } catch (error) {
      console.error(`Error setting up video for user ${userId}:`, error);
    }

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [consumer, userId]);

  return (
    <div className="video-item" id={`participant-${userId}`}>
      {!isVideoLoaded && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
        </div>
      )}
      <video ref={videoRef} id={`video-${userId}`} autoPlay playsInline></video>
      <div className="user-label">User {userId.split("-")[1]}</div>
    </div>
  );
};

export default VideoContainer;

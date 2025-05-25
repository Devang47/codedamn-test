import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMediaSoup } from "../context/MediaSoupContext";
import VideoContainer from "../components/VideoContainer";

function Watch() {
  const { joinRoomAsSpectator, state, leaveRoom } = useMediaSoup();
  const [isConnected, setIsConnected] = useState(false);

  // Join room as spectator when component mounts
  useEffect(() => {
    if (!state.isConnected) {
      joinRoomAsSpectator();
      setIsConnected(true);
    } else {
      setIsConnected(true);
    }

    return () => {
      if (state.isConnected) {
        leaveRoom();
        setIsConnected(false);
      }
    };
  }, []);

  return (
    <div className="watch-page">
      <div className="header">
        <Link to="/" className="back-link">
          ← Back to Home
        </Link>
        <h1>Spectator Mode: Room {state.roomId}</h1>
      </div>

      <div className="spectator-info">
        <div className="status-badge">
          <span
            className={`status-indicator ${
              isConnected ? "connected" : "connecting"
            }`}
          ></span>
          <span className="status-text">
            {isConnected ? "Connected as Spectator" : "Connecting..."}
          </span>
        </div>
        <p>You are in view-only mode. Participants cannot see or hear you.</p>
        <p>Participants in room: {state.participants.size}</p>
      </div>

      <div className="video-container-wrapper">
        {state.participants.size === 0 ? (
          <div className="empty-room-message">
            <h3>No participants in this room yet</h3>
            <p>When participants join, their video will appear here.</p>
          </div>
        ) : (
          <VideoContainer spectatorMode={true} />
        )}
      </div>
    </div>
  );
}

export default Watch;

import type { FC } from "react";
import "./Controls.css";
import { useMediaSoup } from "../context/MediaSoupContext";

interface ControlsProps {
  isJoined: boolean;
  setIsJoined: (isJoined: boolean) => void;
}

const Controls: FC<ControlsProps> = ({ isJoined, setIsJoined }) => {
  const {
    joinRoom,
    leaveRoom,
    toggleAudio,
    toggleVideo,
    isAudioEnabled,
    isVideoEnabled,
  } = useMediaSoup();

  const handleJoin = async () => {
    try {
      await joinRoom();
      setIsJoined(true);
    } catch (error) {
      console.error("Failed to join room:", error);
    }
  };

  const handleLeave = () => {
    leaveRoom();
    setIsJoined(false);
  };

  const handleToggleAudio = () => {
    toggleAudio();
  };

  const handleToggleVideo = () => {
    toggleVideo();
  };

  return (
    <div className="controls">
      <button onClick={handleJoin} disabled={isJoined}>
        Join Room
      </button>
      <button onClick={handleLeave} disabled={!isJoined}>
        Leave Room
      </button>
      <button onClick={handleToggleAudio} disabled={!isJoined}>
        {isAudioEnabled ? "Mute Audio" : "Unmute Audio"}
      </button>
      <button onClick={handleToggleVideo} disabled={!isJoined}>
        {isVideoEnabled ? "Turn Off Video" : "Turn On Video"}
      </button>
    </div>
  );
};

export default Controls;

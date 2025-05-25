import { useMediaSoup } from "../context/MediaSoupContext";

interface ControlsProps {
  isJoined: boolean;
  setIsJoined: (joined: boolean) => void;
}

function Controls({ isJoined, setIsJoined }: ControlsProps) {
  const {
    joinRoom,
    leaveRoom,
    toggleAudio,
    toggleVideo,
    isAudioEnabled,
    isVideoEnabled,
  } = useMediaSoup();

  const handleJoinClick = async () => {
    await joinRoom();
    setIsJoined(true);
  };

  const handleLeaveClick = () => {
    leaveRoom();
    setIsJoined(false);
  };

  return (
    <div className="controls">
      {!isJoined ? (
        <button className="control-button primary" onClick={handleJoinClick}>
          Stream Video
        </button>
      ) : (
        <>
          <button className="control-button" onClick={toggleAudio}>
            {isAudioEnabled ? "🎤 Mute" : "🔇 Unmute"}
          </button>
          <button className="control-button" onClick={toggleVideo}>
            {isVideoEnabled ? "📹 Hide Video" : "🚫 Show Video"}
          </button>
          <button className="control-button danger" onClick={handleLeaveClick}>
            <span className="icon">⏏️</span> Leave Room
          </button>
        </>
      )}
    </div>
  );
}

export default Controls;

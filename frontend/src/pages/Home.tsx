import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaSoup } from "../context/MediaSoupContext";
import Controls from "../components/Controls";
import VideoContainer from "../components/VideoContainer";

function Home() {
  const [isJoined, setIsJoined] = useState(false);
  const navigate = useNavigate();
  const { state } = useMediaSoup();

  const handleWatchMainRoom = () => {
    navigate("/watch");
  };

  return (
    <div className="home-page">
      <h1>MediaSoup Video Conference</h1>

      <div className="room-options">
        <div className="option-card">
          <h2>Join as Participant</h2>
          <div className="main-room">
            <Controls isJoined={isJoined} setIsJoined={setIsJoined} />
            {isJoined && <VideoContainer />}
          </div>
        </div>

        {!isJoined && (
          <div className="option-card">
            <h2>Spectator Options</h2>
            <div className="spectator-options">
              <button onClick={handleWatchMainRoom} className="watch-button">
                Watch
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="current-room-info">
        {isJoined && (
          <p>
            Current room: <strong>{state.roomId}</strong> | Your ID:{" "}
            <strong>{state.userId}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

export default Home;

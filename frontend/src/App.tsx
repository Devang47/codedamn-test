import { useState } from "react";
import "./App.css";
import VideoContainer from "./components/VideoContainer";
import Controls from "./components/Controls";
import { MediaSoupProvider } from "./context/MediaSoupContext";

function App() {
  const [isJoined, setIsJoined] = useState(false);

  return (
    <MediaSoupProvider>
      <div className="container">
        <h1>MediaSoup Video Conference</h1>
        <Controls isJoined={isJoined} setIsJoined={setIsJoined} />
        <VideoContainer />
      </div>
    </MediaSoupProvider>
  );
}

export default App;

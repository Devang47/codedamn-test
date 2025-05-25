import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MediaSoupProvider } from "./context/MediaSoupContext";
import Home from "./pages/Home";
import Watch from "./pages/Watch";

function App() {
  return (
    <MediaSoupProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/watch" element={<Watch />} />
        </Routes>
      </BrowserRouter>
    </MediaSoupProvider>
  );
}

export default App;

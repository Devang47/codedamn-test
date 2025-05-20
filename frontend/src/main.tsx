import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import * as mediasoupClient from "mediasoup-client";
import { io } from "socket.io-client";

// Define global types for libraries
declare global {
  interface Window {
    mediasoupClient: typeof mediasoupClient;
    io: typeof io;
  }
}

// Make libraries globally available for compatibility with any existing code
window.mediasoupClient = mediasoupClient;
window.io = io;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

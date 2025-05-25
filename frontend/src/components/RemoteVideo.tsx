import { useEffect, useRef } from "react";

interface RemoteVideoProps {
  userId: string;
  consumer: any; // MediaSoup consumer
}

function RemoteVideo({ userId, consumer }: RemoteVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Connect the consumer's track to the video element when component mounts
  useEffect(() => {
    if (videoRef.current && consumer) {
      const stream = new MediaStream([consumer.track]);
      videoRef.current.srcObject = stream;

      // Handle potential autoplay issues
      videoRef.current.play().catch((error) => {
        console.error("Error auto-playing remote video:", error);

        // Implement autoplay recovery strategy
        const playOnInteraction = () => {
          videoRef.current?.play();
          document.removeEventListener("click", playOnInteraction);
        };

        document.addEventListener("click", playOnInteraction);
      });
    }

    return () => {
      // Clean up when unmounting
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [consumer]);

  // Extract user ID for display
  const userDisplayId = userId.split("-")[1] || userId;

  return (
    <div className="video-item remote-video">
      <video ref={videoRef} autoPlay playsInline></video>
      <div className="user-label">User {userDisplayId}</div>
    </div>
  );
}

export default RemoteVideo;

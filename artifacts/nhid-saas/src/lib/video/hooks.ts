import { useEffect, useState, useRef } from "react";

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);
  const durationValues = Object.values(durations);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    
    // Simulate window.startRecording if it exists
    if (currentScene === 0 && (window as any).startRecording) {
      (window as any).startRecording();
    }

    const duration = durationValues[currentScene];
    if (duration) {
      timeout = setTimeout(() => {
        if (currentScene < durationValues.length - 1) {
          setCurrentScene(currentScene + 1);
        } else {
          // Loop and stop recording if needed
          if ((window as any).stopRecording) {
            (window as any).stopRecording();
          }
          setCurrentScene(0);
        }
      }, duration);
    }

    return () => clearTimeout(timeout);
  }, [currentScene, durationValues]);

  return { currentScene };
}

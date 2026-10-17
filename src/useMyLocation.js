
import { useCallback, useEffect, useRef, useState } from "react";

function messageFor(err) {
  if (err.code === 1) return "Location access is blocked. Allow it in your browser settings and try again.";
  if (err.code === 2) return "Your device couldn’t work out where it is. Check that location is turned on.";
  if (err.code === 3) return "Finding your location is taking too long. Try again with a clearer signal.";
  return "We couldn’t read your location.";
}

// Live location from the browser. Works on https:// pages and on localhost,
// and only after the person allows it. Nothing is stored by this hook.
export function useMyLocation() {
  const [position, setPosition] = useState(null); // { lat, lng, accuracy, heading }
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const watchId = useRef(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setActive(false);
    setPosition(null);
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser doesn’t support location.");
      return;
    }
    if (watchId.current !== null) return; // already running
    setError("");
    setActive(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) =>
        setPosition({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null, // only while moving
        }),
      (err) => {
        setError(messageFor(err));
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }, [stop]);

  // Stop watching when the component unmounts.
  useEffect(() => stop, [stop]);

  return { position, active, error, start, stop };
}

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";
import { useMyLocation } from "./useMyLocation";
import { useRoute } from "./useRoute";
import { nextManeuver, formatDistance, formatDuration } from "./Routing";
import { distanceMeters } from "./Geo";
import { pinIcon, makeDriverIcon } from "./mapIcons";
import HouseOutline from "./HouseOutline";

const SEND_EVERY_MS = 5000;
const NEAR_TURN_M = 150; // say the turn again when this close

async function requestWakeLock(ref) {
  try {
    ref.current = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    // Not supported or refused. Tracking still works, the screen just may dim.
  }
}

async function releaseWakeLock(ref) {
  try {
    await ref.current?.release();
  } catch {
    // ignore
  }
  ref.current = null;
}

function speak(text) {
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    // Speech not supported: the on-screen banner still works.
  }
}

// Arrow for the next maneuver, rotated from "straight ahead".
const ROTATION = {
  straight: 0,
  "slight right": 45,
  right: 90,
  "sharp right": 135,
  uturn: 180,
  "sharp left": -135,
  left: -90,
  "slight left": -45,
};

function TurnArrow({ modifier }) {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 44 44"
      aria-hidden="true"
      className="shrink-0"
      style={{ transform: `rotate(${ROTATION[modifier] ?? 0}deg)` }}
    >
      <path d="M22 6 L34 22 H26 V38 H18 V22 H10 Z" fill="currentColor" />
    </svg>
  );
}

// Keeps the map centred on the driver until they drag it themselves.
function FollowDriver({ position, follow, onUserMove }) {
  const map = useMap();
  useMapEvents({ dragstart: onUserMove });
  useEffect(() => {
    if (follow && position) {
      map.setView([position.lat, position.lng], Math.max(map.getZoom(), 17), { animate: true });
    }
  }, [follow, position, map]);
  return null;
}

// Built for one tap before the drive. After "Start delivery" the driver gets turn-by-turn
// directions and never has to touch the screen until they arrive.
export default function DriverTracker({ deliveryId }) {
  const [delivery, setDelivery] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | ready | driving | ending | done | error
  const [message, setMessage] = useState("");
  const [follow, setFollow] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const { position, error: geoError, start, stop } = useMyLocation();
  const latest = useRef(null);
  const wakeLock = useRef(null);
  const spoken = useRef({ key: null, near: false });

  const destLat = delivery?.dest_lat ?? null;
  const destLng = delivery?.dest_lng ?? null;
  const showNav = phase === "driving" || phase === "ending";

  const { route, routeAhead, aheadIndex } = useRoute(
    position?.lat ?? null,
    position?.lng ?? null,
    destLat,
    destLng,
    showNav
  );
  const nextStep = route ? nextManeuver(route, aheadIndex) : null;
  const distToNext =
    position && nextStep
      ? distanceMeters(position, { lat: nextStep.location[0], lng: nextStep.location[1] })
      : null;

  // Direction arrow from the phone's own GPS heading (only available while moving).
  const gpsHeading = position?.heading ?? null;
  const driverIcon = useMemo(
    () => makeDriverIcon(gpsHeading === null ? null : Math.round(gpsHeading / 5) * 5),
    [gpsHeading]
  );

  // Load the delivery. Row Level Security only returns it if it is assigned to this driver.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select("id, address, status, dest_lat, dest_lng, dest_geojson")
        .eq("id", deliveryId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setMessage("This delivery isn’t assigned to you.");
        setPhase("error");
        return;
      }
      setDelivery(data);
      if (data.status === "delivered") {
        setPhase("done");
      } else if (data.status === "on_the_way") {
        // The page was reloaded mid-trip: pick up where we left off.
        start();
        requestWakeLock(wakeLock);
        setPhase("driving");
      } else {
        setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, start]);

  useEffect(() => {
    latest.current = position;
  }, [position]);

  // Send the latest position every few seconds. A timer (instead of "on every GPS change")
  // keeps the customer's map fresh even when the driver is stopped at a light.
  useEffect(() => {
    if (phase !== "driving") return;
    const id = setInterval(async () => {
      const p = latest.current;
      if (!p) return;
      const { error } = await supabase
        .from("driver_locations")
        .upsert({ delivery_id: deliveryId, lat: p.lat, lng: p.lng });
      setMessage(error ? "Couldn’t send your location. Retrying…" : "");
    }, SEND_EVERY_MS);
    return () => clearInterval(id);
  }, [phase, deliveryId]);

  // Optional spoken directions: announce each turn once when it becomes next,
  // and once more when the driver is close to it.
  useEffect(() => {
    if (!voiceOn || !nextStep || distToNext === null) return;
    const key = `${nextStep.location[0].toFixed(5)},${nextStep.location[1].toFixed(5)}`;
    const near = distToNext <= NEAR_TURN_M;
    if (spoken.current.key !== key) {
      spoken.current = { key, near };
      speak(near ? nextStep.text : `In ${formatDistance(distToNext)}, ${nextStep.text}`);
    } else if (!spoken.current.near && near) {
      spoken.current.near = true;
      speak(nextStep.text);
    }
  }, [voiceOn, nextStep, distToNext]);

  function toggleVoice() {
    if (voiceOn) window.speechSynthesis?.cancel();
    spoken.current = { key: null, near: false };
    setVoiceOn((v) => !v);
  }

  async function startTrip() {
    setMessage("");
    const { error } = await supabase
      .from("deliveries")
      .update({ status: "on_the_way" })
      .eq("id", deliveryId);
    if (error) {
      setMessage("Couldn’t start the delivery. Check your connection and try again.");
      return;
    }
    start();
    requestWakeLock(wakeLock);
    setPhase("driving");
  }

  async function finishTrip() {
    setMessage("");
    setPhase("ending"); // clears the send timer
    // Mark delivered first: once the status changes, the database rejects any late location writes.
    const { error } = await supabase
      .from("deliveries")
      .update({ status: "delivered" })
      .eq("id", deliveryId);
    if (error) {
      setMessage("Couldn’t finish the delivery. Try again.");
      setPhase("driving");
      return;
    }
    await supabase.from("driver_locations").delete().eq("delivery_id", deliveryId);
    stop();
    window.speechSynthesis?.cancel();
    await releaseWakeLock(wakeLock);
    setPhase("done");
  }

  if (phase === "loading") return <p className="p-6 text-sm">Loading delivery…</p>;

  if (phase === "error") {
    return (
      <p className="p-6 text-sm" role="alert">
        {message}
      </p>
    );
  }

  const destination = destLat !== null && destLng !== null ? { lat: destLat, lng: destLng } : null;

  // Navigation screen: next turn on top, map in the middle, controls at the bottom.
  if (showNav) {
    return (
      <section className="flex min-h-screen flex-col bg-paper text-ink">
        <div className="bg-ink px-4 py-4 text-white" role="status" aria-live="polite">
          {nextStep ? (
            <div className="flex items-center gap-4">
              <TurnArrow modifier={nextStep.modifier} />
              <div className="min-w-0">
                <p className="text-3xl font-semibold tabular-nums">
                  {distToNext !== null ? formatDistance(distToNext) : ""}
                </p>
                <p className="text-base leading-snug text-white/85">{nextStep.text}</p>
              </div>
            </div>
          ) : (
            <p className="text-base">
              {position
                ? destination
                  ? "Finding the best road…"
                  : "This delivery has no map location. Use the address below."
                : "Finding your location…"}
            </p>
          )}
        </div>

        <div className="relative isolate min-h-[320px] flex-1">
          <MapContainer
            center={destination ? [destination.lat, destination.lng] : [20, 0]}
            zoom={destination ? 17 : 2}
            maxZoom={19}
            scrollWheelZoom
            className="absolute inset-0"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. Routing by <a href="https://project-osrm.org">OSRM</a>'
              maxZoom={19}
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <HouseOutline geojson={delivery?.dest_geojson} />
            {routeAhead && (
              <>
                <Polyline positions={routeAhead} pathOptions={{ color: "#ffffff", weight: 10, opacity: 0.9 }} />
                <Polyline positions={routeAhead} pathOptions={{ color: "#0F766E", weight: 6, opacity: 0.95 }} />
              </>
            )}
            {destination && <Marker position={[destination.lat, destination.lng]} icon={pinIcon} />}
            {position && <Marker position={[position.lat, position.lng]} icon={driverIcon} />}
            <FollowDriver position={position} follow={follow} onUserMove={() => setFollow(false)} />
          </MapContainer>
          {!follow && (
            <button
              type="button"
              onClick={() => setFollow(true)}
              className="absolute bottom-4 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-white shadow-lg"
            >
              Recenter on me
            </button>
          )}
        </div>

        <div className="space-y-3 bg-white px-4 py-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-pine" role="status">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pine" />
              </span>
              {position ? "Sharing your location with the customer" : "Finding your location…"}
            </p>
            <button
              type="button"
              onClick={toggleVoice}
              aria-pressed={voiceOn}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                voiceOn ? "border-pine bg-pine text-white" : "border-ink/15 bg-white"
              }`}
            >
              {voiceOn ? "Voice on" : "Voice off"}
            </button>
          </div>

          {route && (
            <p className="text-sm text-ink/70">
              About {formatDuration(route.durationS)} to go, {formatDistance(route.distanceM)} by road.
            </p>
          )}
          {delivery?.address && <p className="text-sm text-ink/60">Deliver to {delivery.address}</p>}

          {(message || geoError) && (
            <p className="text-sm text-red-700" role="alert">
              {message || geoError}
            </p>
          )}

          <button
            type="button"
            onClick={finishTrip}
            disabled={phase === "ending"}
            className="w-full rounded-xl bg-ink px-4 py-5 text-lg font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
          >
            {phase === "ending" ? "Finishing…" : "Finish delivery"}
          </button>
          <p className="text-xs text-ink/55">
            Glance only while moving. Pull over before using the map or the buttons.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-screen place-items-center bg-paper px-4 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
        <p className="text-sm text-ink/60">Deliver to</p>
        <h1 className="mt-1 text-2xl font-semibold leading-snug">{delivery?.address || "Customer address"}</h1>

        {phase === "ready" && (
          <>
            <p className="mt-4 text-sm leading-relaxed text-ink/70">
              Start the delivery before you set off. You will get turn-by-turn directions, and your
              location is shared with the customer only until you finish.
            </p>
            <button
              type="button"
              onClick={startTrip}
              className="mt-6 w-full rounded-xl bg-pine px-4 py-5 text-lg font-semibold text-white hover:bg-pine/90"
            >
              Start delivery
            </button>
          </>
        )}

        {phase === "done" && (
          <p className="mt-5 text-sm font-medium text-pine" role="status">
            Delivery complete. Location sharing has stopped.
          </p>
        )}

        {(message || geoError) && (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {message || geoError}
          </p>
        )}
      </div>
    </section>
  );
}

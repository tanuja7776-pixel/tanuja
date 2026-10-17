import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";
import { pinIcon, makeDriverIcon } from "./mapIcons";
import { formatDistance, formatDuration } from "./Routing";
import { useRoute } from "./useRoute";
import { distanceMeters, bearing, compassName } from "./Geo";
import HouseOutline from "./HouseOutline";

const STALE_AFTER_SECONDS = 60;
const HEADING_MIN_MOVE_M = 15; // ignore GPS jitter when working out direction

// Frames the driver and the destination once the driver appears, and again
// when the customer presses the button. It does not move the map on every
// update, so it never fights the customer while they pan around.
function FitBoth({ driver, destination, recenterKey }) {
  const map = useMap();
  const hasDriver = Boolean(driver);
  useEffect(() => {
    const points = [];
    if (destination) points.push([destination.lat, destination.lng]);
    if (driver) points.push([driver.lat, driver.lng]);
    if (points.length === 1) map.setView(points[0], 17); // close enough to see the houses
    if (points.length > 1) map.fitBounds(points, { padding: [60, 60], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDriver, recenterKey, map]);
  return null;
}

export default function TrackDelivery({ deliveryId }) {
  const [delivery, setDelivery] = useState(null);
  const [driver, setDriver] = useState(null); // { lat, lng, updated_at }
  const [loadState, setLoadState] = useState("loading"); // loading | ready | error
  const [recenterKey, setRecenterKey] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [heading, setHeading] = useState(null); // degrees, or null until the driver has moved
  const prevPos = useRef(null);

  const driverLat = driver?.lat ?? null;
  const driverLng = driver?.lng ?? null;
  const destLat = delivery?.dest_lat ?? null;
  const destLng = delivery?.dest_lng ?? null;
  const onTheWay = delivery?.status === "on_the_way";

  const { route, routeAhead } = useRoute(driverLat, driverLng, destLat, destLng, onTheWay);

  // Re-render every few seconds so "updated Xs ago" stays accurate.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Load the delivery, then listen for live changes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Row Level Security only returns this if the signed-in person is the customer.
      const { data: d, error } = await supabase
        .from("deliveries")
        .select("id, address, dest_lat, dest_lng, dest_geojson, status")
        .eq("id", deliveryId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !d) {
        setLoadState("error");
        return;
      }
      setDelivery(d);
      setLoadState("ready");

      const { data: loc } = await supabase
        .from("driver_locations")
        .select("lat, lng, updated_at")
        .eq("delivery_id", deliveryId)
        .maybeSingle();
      if (!cancelled && loc) setDriver(loc);
    })();

    const channel = supabase
      .channel(`delivery-${deliveryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations", filter: `delivery_id=eq.${deliveryId}` },
        (payload) => {
          if (payload.eventType === "DELETE") setDriver(null);
          else setDriver(payload.new);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deliveries", filter: `id=eq.${deliveryId}` },
        (payload) => {
          setDelivery((prev) => ({ ...prev, status: payload.new.status }));
          if (payload.new.status !== "on_the_way") setDriver(null);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [deliveryId]);

  // Direction of travel: the bearing between the last two driver positions that are far
  // enough apart to be real movement (not GPS wobble).
  useEffect(() => {
    if (driverLat === null) {
      prevPos.current = null;
      setHeading(null);
      return;
    }
    const current = { lat: driverLat, lng: driverLng };
    const prev = prevPos.current;
    if (!prev) {
      prevPos.current = current;
      return;
    }
    if (distanceMeters(prev, current) >= HEADING_MIN_MOVE_M) {
      setHeading(bearing(prev, current));
      prevPos.current = current;
    }
  }, [driverLat, driverLng]);

  // Rounded to 5 degrees so the marker isn't rebuilt for tiny changes.
  const driverIcon = useMemo(
    () => makeDriverIcon(heading === null ? null : Math.round(heading / 5) * 5),
    [heading]
  );

  if (loadState === "loading") return <p className="p-6 text-sm">Loading your delivery…</p>;

  if (loadState === "error") {
    return (
      <p className="p-6 text-sm" role="alert">
        We couldn’t open this delivery. Sign in with the account that placed the order.
      </p>
    );
  }

  const destination = destLat !== null && destLng !== null ? { lat: destLat, lng: destLng } : null;

  const ageSeconds = driver
    ? Math.max(0, Math.round((now - new Date(driver.updated_at).getTime()) / 1000))
    : null;
  const stale = ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS;
  const direction = heading === null ? "" : ` Heading ${compassName(heading)}.`;

  let headline;
  let detail = "";
  if (delivery.status === "delivered") {
    headline = "Delivered";
  } else if (delivery.status === "pending") {
    headline = "Your driver hasn’t started yet";
  } else if (!driver) {
    headline = "Your driver is on the way";
    detail = "Waiting for their location…";
  } else if (stale) {
    headline = "Signal lost";
    detail = `Last seen ${Math.round(ageSeconds / 60)} min ago. The driver may be in a low-signal area.`;
  } else {
    headline = "Your driver is on the way";
    if (route) {
      detail = `About ${formatDuration(route.durationS)} away, ${formatDistance(route.distanceM)} by road.${direction} Updated ${ageSeconds}s ago.`;
    } else if (destination) {
      detail = `${formatDistance(distanceMeters(driver, destination))} away in a straight line.${direction} Updated ${ageSeconds}s ago.`;
    } else {
      detail = `Updated ${ageSeconds}s ago.${direction}`;
    }
  }

  return (
    <section className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
        {detail && (
          <p className="mt-1 text-sm text-ink/70" role="status">
            {detail}
          </p>
        )}
        {delivery.address && <p className="mt-1 text-sm text-ink/60">Delivering to {delivery.address}</p>}

        <div className="isolate mt-5 h-[60vh] overflow-hidden rounded-2xl border border-ink/10 shadow-sm">
          <MapContainer center={[20, 0]} zoom={2} maxZoom={19} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. Routing by <a href="https://project-osrm.org">OSRM</a>'
              maxZoom={19}
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <HouseOutline geojson={delivery.dest_geojson} />
            {routeAhead && (
              <>
                {/* White outline underneath keeps the route readable on busy map areas */}
                <Polyline positions={routeAhead} pathOptions={{ color: "#ffffff", weight: 9, opacity: 0.9 }} />
                <Polyline positions={routeAhead} pathOptions={{ color: "#0F766E", weight: 5, opacity: 0.9 }} />
              </>
            )}
            {destination && (
              <Marker position={[destination.lat, destination.lng]} icon={pinIcon}>
                <Popup>Your delivery address</Popup>
              </Marker>
            )}
            {driver && (
              <Marker position={[driver.lat, driver.lng]} icon={driverIcon}>
                <Popup>Your driver</Popup>
              </Marker>
            )}
            <FitBoth driver={driver} destination={destination} recenterKey={recenterKey} />
          </MapContainer>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setRecenterKey((k) => k + 1)}
            className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm font-medium hover:bg-ink/5"
          >
            Show driver and address
          </button>
          <p className="text-xs text-ink/55">
            The route and arrival time are estimates and don’t include live traffic.
          </p>
        </div>
      </div>
    </section>
  );
}
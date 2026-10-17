import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { pinIcon } from "./mapIcons";
import { useMyLocation } from "./useMyLocation";
import HouseOutline from "./HouseOutline";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_CENTER = [20, 0];
const DEFAULT_ZOOM = 2;

// Moves the map whenever a new result arrives.
function FlyToResult({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.flyToBounds(bounds, { maxZoom: 18, padding: [40, 40], duration: 1.2 });
    }
  }, [bounds, map]);
  return null;
}

// Blue dot (plus an accuracy circle) for the customer's own live location.
function MyLocationLayer({ position }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!position) {
      first.current = true;
      return;
    }
    if (first.current) {
      first.current = false;
      map.flyTo([position.lat, position.lng], 16, { duration: 1.2 });
    }
  }, [position, map]);

  if (!position) return null;
  const center = [position.lat, position.lng];
  return (
    <>
      <Circle center={center} radius={position.accuracy} pathOptions={{ color: "#2563EB", weight: 1, fillOpacity: 0.1 }} />
      <CircleMarker center={center} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2563EB", fillOpacity: 1 }} />
    </>
  );
}

// Turns Nominatim's address parts into two readable lines.
function formatAddress(result) {
  const a = result.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const place = a.city || a.town || a.village || a.suburb || a.county;
  const line1 = street || result.label.split(",")[0];
  const line2 = [place, a.state, a.postcode, a.country].filter(Boolean).join(", ");
  return { line1, line2: line2 || result.label };
}

function SummaryCard({ status, result, confirmed, onConfirm }) {
  if (status === "idle") {
    return (
      <div className="rounded-2xl border border-dashed border-ink/25 p-5 text-sm text-ink/60">
        No address pinned yet. Search above and your delivery details will appear here.
      </div>
    );
  }

  if (status === "searching") {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white p-5 text-sm text-ink/70" role="status">
        Looking up your address…
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="rounded-2xl border border-saffron/50 bg-saffron/10 p-5 text-sm" role="alert">
        <p className="font-medium">We couldn’t find that address.</p>
        <p className="mt-1 text-ink/70">
          Try adding the city or postcode, or check the spelling.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm" role="alert">
        <p className="font-medium">The address service didn’t respond.</p>
        <p className="mt-1 text-ink/70">Check your connection and press Find address again.</p>
      </div>
    );
  }

  const { line1, line2 } = formatAddress(result);

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-sm">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${confirmed ? "bg-pine text-white" : "bg-pine/10 text-pine"
          }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {confirmed ? "Delivery address confirmed" : "Found on the map"}
      </span>

      <h2 className="mt-4 text-lg font-semibold leading-snug">{line1}</h2>
      <p className="mt-1 text-sm text-ink/70">{line2}</p>

      {result.approximate && (
        <p className="mt-3 rounded-lg bg-saffron/15 px-3 py-2 text-xs leading-relaxed">
          We couldn’t find the exact door, so this pin is approximate. It matches “{result.matched}”.
          Check the map before confirming.
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ink/10 pt-4 text-sm">
        <div>
          <dt className="text-ink/50">Latitude</dt>
          <dd className="font-medium tabular-nums">{result.lat.toFixed(5)}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Longitude</dt>
          <dd className="font-medium tabular-nums">{result.lon.toFixed(5)}</dd>
        </div>
      </dl>

      {!confirmed && (
        <button
          type="button"
          onClick={onConfirm}
          className="mt-5 w-full rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white transition hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"
        >
          Deliver to this address
        </button>
      )}
    </div>
  );
}

// Nominatim can return the real building outline. Only use it when it is house-sized,
// not a whole city or district boundary.
function houseOutline(top) {
  const g = top.geojson;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
  const [south, north, west, east] = top.boundingbox.map(Number);
  if (north - south > 0.01 || east - west > 0.01) return null;
  return g;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tries the full address first. If Nominatim finds nothing, drops the most
// specific part (the first comma-separated chunk) and tries again, keeping
// at least two parts. Waits 1.1s between tries to respect Nominatim's rate limit.
async function searchWithFallback(q, signal) {
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
  const candidates = [q];
  for (let i = 1; i <= parts.length - 2; i++) {
    candidates.push(parts.slice(i).join(", "));
  }

  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await wait(1100);
    const url = `${NOMINATIM_URL}?format=json&addressdetails=1&polygon_geojson=1&limit=1&q=${encodeURIComponent(candidates[i])}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Search failed with status ${res.status}`);
    const data = await res.json();
    if (data.length > 0) {
      return { top: data[0], matched: candidates[i], approximate: i > 0 };
    }
  }
  return null;
}

export default function DeliveryAddressMap() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle"); // idle | searching | found | not_found | error
  const [result, setResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const abortRef = useRef(null);
  const me = useMyLocation();

  // With Supabase configured, hand the address to the sign-in and order step.
  // Without it, just show the "confirmed" state so the page still works on its own.
  function handleConfirm() {
    if (!import.meta.env.VITE_SUPABASE_URL) {
      setConfirmed(true);
      return;
    }
    try {
      localStorage.setItem(
        "pendingDelivery",
        JSON.stringify({ address: result.label, lat: result.lat, lon: result.lon, geojson: result.geojson })
      );
    } catch {
      // Storage blocked: fall back to the local confirmed state.
      setConfirmed(true);
      return;
    }
    window.location.assign("/?mode=confirm");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // Cancel any search that is still in flight.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("searching");
    setConfirmed(false);

    try {
      const found = await searchWithFallback(q, controller.signal);
      if (!found) {
        setResult(null);
        setStatus("not_found");
        return;
      }

      const { top, matched, approximate } = found;
      const [south, north, west, east] = top.boundingbox.map(Number);
      setResult({
        lat: Number(top.lat),
        lon: Number(top.lon),
        label: top.display_name,
        address: top.address,
        approximate,
        matched,
        geojson: houseOutline(top),
        bounds: [
          [south, west],
          [north, east],
        ],
      });
      setStatus("found");
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error(err);
      setResult(null);
      setStatus("error");
    }
  }

  return (
    <section className="delivery-page min-h-screen text-ink">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[400px_1fr] lg:py-14">
        <div className="flex flex-col gap-6">
          <header>
            <h1 className="text-3xl font-semibold tracking-tight">Where should we deliver?</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/70">
              Enter your address and we’ll pin it on the map so you can check it’s the right door.
            </p>
          </header>

          <form onSubmit={handleSubmit}>
            <label htmlFor="address" className="mb-1.5 block text-sm font-medium">
              Delivery address
            </label>
            <div className="flex gap-2">
              <input
                id="address"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="House number, street, city"
                autoComplete="street-address"
                className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm placeholder:text-ink/40 focus:border-pine focus:outline-2 focus:outline-pine/30"
              />
              <button
                type="submit"
                disabled={status === "searching" || !query.trim()}
                className="shrink-0 rounded-xl bg-pine px-5 py-3 text-sm font-medium text-white transition hover:bg-pine/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "searching" ? "Searching…" : "Find address"}
              </button>
            </div>
            <button
              type="button"
              onClick={me.active ? me.stop : me.start}
              className="mt-3 text-sm font-medium text-pine underline-offset-2 hover:underline"
            >
              {me.active ? "Stop showing my location" : "Show my live location"}
            </button>
            {me.error && (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {me.error}
              </p>
            )}
          </form>

          <SummaryCard
            status={status}
            result={result}
            confirmed={confirmed}
            onConfirm={handleConfirm}
          />
        </div>

        {/* "isolate" keeps Leaflet's high z-index layers from covering sticky headers or modals */}
        <div className="isolate h-[420px] overflow-hidden rounded-2xl border border-ink/10 shadow-sm lg:h-[620px]">
          <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} maxZoom={19} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MyLocationLayer position={me.position} />
            {result && (
              <>
                <Marker position={[result.lat, result.lon]} icon={pinIcon}>
                  <Popup>{formatAddress(result).line1}</Popup>
                </Marker>
                <HouseOutline geojson={result.geojson} />
                <FlyToResult bounds={result.bounds} />
              </>
            )}
          </MapContainer>
        </div>
      </div>
    </section>
  );
}


import { useEffect, useMemo, useRef, useState } from "react";
import { getRoute } from "./Routing";
import { distanceMeters, nearestPointIndex } from "./Geo";

const MIN_INTERVAL_MS = 20000; // normal refresh: at most this often...
const MIN_MOVE_M = 100; // ...and only after moving this far
const OFF_ROUTE_M = 60; // farther than this from the line = the driver took another road
const OFF_ROUTE_INTERVAL_MS = 8000; // so re-route sooner, but still not too often

// Keeps a road route from (fromLat, fromLng) to (toLat, toLng) up to date.
// The free routing server is shared, so requests are throttled.
//
// Returns:
//   route       the latest route (or null)
//   routeAhead  the part of the line still ahead of the driver
//   aheadIndex  how far along route.points the driver is
export function useRoute(fromLat, fromLng, toLat, toLng, enabled) {
    const [route, setRoute] = useState(null);
    const meta = useRef({ at: 0, lat: null, lng: null });
    const controller = useRef(null);

    useEffect(() => {
        if (!enabled || fromLat === null || toLat === null) {
            meta.current = { at: 0, lat: null, lng: null };
            setRoute(null);
            return;
        }

        const last = meta.current;
        let shouldFetch = last.lat === null;
        if (!shouldFetch) {
            const age = Date.now() - last.at;
            const moved = distanceMeters({ lat: fromLat, lng: fromLng }, { lat: last.lat, lng: last.lng });
            const offRoute = route ? nearestPointIndex(route.points, fromLat, fromLng).distM > OFF_ROUTE_M : false;
            shouldFetch =
                (age >= MIN_INTERVAL_MS && moved >= MIN_MOVE_M) || (offRoute && age >= OFF_ROUTE_INTERVAL_MS);
        }
        if (!shouldFetch) return;

        meta.current = { at: Date.now(), lat: fromLat, lng: fromLng };
        controller.current?.abort();
        const current = new AbortController();
        controller.current = current;

        getRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, current.signal)
            .then(setRoute)
            .catch((err) => {
                if (err.name === "AbortError") return;
                console.warn("Route lookup failed", err);
                meta.current = { at: 0, lat: null, lng: null }; // try again on the next movement
            });
    }, [enabled, fromLat, fromLng, toLat, toLng, route]);

    useEffect(() => () => controller.current?.abort(), []);

    const progress = useMemo(() => {
        if (!route) return { routeAhead: null, aheadIndex: 0 };
        if (fromLat === null) return { routeAhead: route.points, aheadIndex: 0 };
        const { index } = nearestPointIndex(route.points, fromLat, fromLng);
        return {
            routeAhead: [[fromLat, fromLng], ...route.points.slice(index)],
            aheadIndex: index,
        };
    }, [route, fromLat, fromLng]);

    return { route, ...progress };
}

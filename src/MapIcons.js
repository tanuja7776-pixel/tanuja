import L from "leaflet";

// Destination pin. A custom SVG avoids the well-known "broken marker image"
// problem that Leaflet's default icon has with bundlers like Vite.
export const pinIcon = L.divIcon({
  className: "",
  html: `
    <svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg"
         style="filter: drop-shadow(0 3px 3px rgba(22,34,46,.35))">
      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 28 18 28s18-14.5 18-28C36 8.06 27.94 0 18 0z" fill="#0F766E"/>
      <circle cx="18" cy="18" r="7" fill="#fff"/>
    </svg>`,
  iconSize: [36, 46],
  iconAnchor: [18, 46],
  popupAnchor: [0, -42],
});

// Driver marker: a saffron disc, so it reads differently from the teal destination pin.
export const driverIcon = L.divIcon({
  className: "",
  html: `
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"
         style="filter: drop-shadow(0 2px 3px rgba(22,34,46,.4))">
      <circle cx="20" cy="20" r="17" fill="#E8A317" stroke="#fff" stroke-width="3"/>
      <circle cx="20" cy="20" r="6" fill="#16222E"/>
    </svg>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -18],
});

// Driver marker with a direction arrow. `heading` is degrees clockwise from north
// (0 = north, 90 = east). With no heading yet, it falls back to the plain disc.
export function makeDriverIcon(heading) {
  if (heading == null) return driverIcon;
  return L.divIcon({
    className: "",
    html: `
      <div style="width:44px;height:44px;transform:rotate(${heading}deg);filter:drop-shadow(0 2px 3px rgba(22,34,46,.4))">
        <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
          <circle cx="22" cy="22" r="19" fill="#E8A317" stroke="#fff" stroke-width="3"/>
          <path d="M22 9 L31 32 L22 26 L13 32 Z" fill="#16222E"/>
        </svg>
      </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
  });
}


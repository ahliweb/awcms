
import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix Leaflet default icon issue
let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

function LocationMarker({ position, setPosition, onLocationChange }) {
  const map = useMapEvents({
    click(e) {
      setPosition(e.latlng);
      onLocationChange(e.latlng.lat, e.latlng.lng);
    },
  });

  // Fly to position if it changes externally
  useEffect(() => {
    if (position) {
      map.flyTo(position, map.getZoom());
    }
  }, [position, map]);

  return position === null ? null : (
    <Marker position={position}></Marker>
  );
}

const LocationPicker = ({ lat, lng, onChange }) => {
  // Default to Jakarta, Indonesia coordinates if null
  const defaultPos = { lat: -6.2088, lng: 106.8456 };
  const [position, setPosition] = useState(lat && lng ? { lat, lng } : null);

  useEffect(() => {
    if (lat && lng) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPosition({ lat, lng });
    }
  }, [lat, lng]);

  const handleLocationChange = (newLat, newLng) => {
    onChange(newLat, newLng);
  };

  return (
    <div className="h-[300px] w-full rounded-md overflow-hidden border border-slate-300 z-0 relative">
      <MapContainer
        center={position || defaultPos}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <LocationMarker
          position={position}
          setPosition={setPosition}
          onLocationChange={handleLocationChange}
        />
      </MapContainer>
      <div className="absolute bottom-2 left-2 bg-white/90 px-2 py-1 text-xs rounded z-[1000] pointer-events-none">
        {position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : 'Click map to set location'}
      </div>
    </div>
  );
};

export default LocationPicker;

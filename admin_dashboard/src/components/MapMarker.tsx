import { MarkerF, useGoogleMap } from '@react-google-maps/api';
import { useEffect, useRef } from 'react';
import type { Point } from '../lib/polyline';

interface Props {
  advanced: boolean; position: Point; title: string; label?: string; color?: string; scale?: number; opacity?: number;
  circle?: boolean; draggable?: boolean; onMove?: (point: Point) => void; onClick?: () => void;
}

function AdvancedMarker({ position: { lat, lng }, title, label = '', color = '#be123c', scale = 10, opacity = 1, circle, draggable, onMove, onClick }: Props) {
  const map = useGoogleMap();
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const callbacks = useRef({ onMove, onClick });
  useEffect(() => { callbacks.current = { onMove, onClick }; }, [onMove, onClick]);
  useEffect(() => {
    if (!map) return;
    const marker = new google.maps.marker.AdvancedMarkerElement({ map });
    const moved = () => {
      const p = marker.position;
      if (p) callbacks.current.onMove?.({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng });
    };
    const clicked = () => callbacks.current.onClick?.();
    marker.addEventListener('gmp-dragend', moved); marker.addEventListener('gmp-click', clicked);
    markerRef.current = marker;
    return () => { marker.removeEventListener('gmp-dragend', moved); marker.removeEventListener('gmp-click', clicked); marker.map = null; markerRef.current = null; };
  }, [map]);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.position = { lat, lng }; marker.title = title; marker.gmpDraggable = !!draggable; marker.gmpClickable = !!onClick;
    marker.style.opacity = String(opacity);
    if (circle) {
      const dot = document.createElement('span');
      dot.textContent = label;
      Object.assign(dot.style, { display: 'grid', placeItems: 'center', width: `${scale * 2}px`, height: `${scale * 2}px`, background: color, border: '2px solid white', borderRadius: '50%', color: 'white', fontSize: '11px' });
      marker.replaceChildren(dot); marker.anchorTop = '-50%';
    } else {
      marker.replaceChildren(new google.maps.marker.PinElement({ background: color, borderColor: 'white', glyphColor: 'white', glyphText: label }));
      marker.anchorTop = '-100%';
    }
  }, [map, lat, lng, title, label, color, scale, opacity, circle, draggable, onClick]);
  return null;
}

export default function MapMarker(props: Props) {
  if (props.advanced) return <AdvancedMarker {...props} />;
  const { position, title, label, color = '#be123c', scale = 10, opacity = 1, circle, draggable, onMove, onClick } = props;
  return <MarkerF position={position} title={title} label={label} draggable={draggable} onClick={onClick}
    icon={circle ? { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: opacity, strokeColor: 'white', strokeWeight: 2 } : undefined}
    onDragEnd={event => { if (event.latLng) onMove?.({ lat: event.latLng.lat(), lng: event.latLng.lng() }); }} />;
}

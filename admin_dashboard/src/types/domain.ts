import type { Timestamp } from 'firebase/firestore';

export type EventStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled' | 'archived';
export type GroupStatus = 'waiting' | 'moving' | 'stopped' | 'delayed' | 'completed' | 'emergency';
export type StopPointType = 'temple' | 'ritual' | 'rest' | 'checkpoint' | 'food' | 'medical' | 'roadControl' | 'other';

export interface EventRecord {
  id: string; name: string; description: string; status: EventStatus;
  startTime: Timestamp; endTime: Timestamp | null; organizerId: string;
  routeId: string | null; isPublic: boolean;
  mainTempleName: string; cityRegion: string;
  createdAt: Timestamp; updatedAt: Timestamp | null;
}

export interface EventContactsRecord { organizerContact: string; emergencyContact: string; updatedAt?: Timestamp }

export interface RouteRecord {
  id: string; eventId: string; name: string; description: string;
  color: string; encodedPolyline: string;
  totalDistanceMeters: number; estimatedDurationMinutes: number;
  segmentIds: string[]; stopPointIds: string[];
  createdAt: Timestamp; updatedAt: Timestamp | null;
}

export interface RouteSegmentRecord {
  id: string; routeId: string; order: number; startLatitude: number; startLongitude: number;
  endLatitude: number; endLongitude: number; distanceMeters: number; instruction: string;
}

export interface StopPointRecord {
  id: string; routeId: string; name: string; description: string; type: StopPointType;
  latitude: number; longitude: number; order: number;
  expectedArrivalTime: Timestamp | null; expectedDepartureTime: Timestamp | null;
  plannedStopMinutes: number; geofenceRadiusMeters: number; maxAllowedGroups: number;
}

export interface GroupRecord {
  id: string; eventId: string; name: string; color: string; routeId: string;
  startingStopPointId: string; endingStopPointId: string; leaderUserId: string;
  status: GroupStatus; currentLatitude: number | null; currentLongitude: number | null;
  lastLocationUpdateAt: Timestamp | null; accessCodeId: string | null; memberCount: number;
}
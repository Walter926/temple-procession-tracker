import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../core/models/event.dart';
import '../../core/models/route_model.dart';
import '../../core/models/stop_point.dart';
import '../../core/utils/polyline_decoder.dart';

class PublicMapScreen extends StatefulWidget {
  const PublicMapScreen({super.key});

  @override
  State<PublicMapScreen> createState() => _PublicMapScreenState();
}

class _PublicMapScreenState extends State<PublicMapScreen> {
  static const LatLng _initialPosition = LatLng(49.2827, -123.1207);
  GoogleMapController? _mapController;
  String? _eventId;

  @override
  void dispose() { _mapController?.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Scaffold(appBar: AppBar(title: const Text('Public Procession Map')), body: StreamBuilder(
      stream: FirebaseFirestore.instance.collection('events').where('isPublic', isEqualTo: true).snapshots(),
      builder: (context, snapshot) {
        if (snapshot.hasError) return Center(child: Text('Events unavailable: ${snapshot.error}'));
        if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
        final events = snapshot.data!.docs.map(Event.fromFirestore).toList();
        if (events.isEmpty) return const Center(child: Text('No public events available yet.'));
        final event = events.where((item) => item.id == _eventId).firstOrNull ?? events.first;
        return Column(children: [
          Padding(padding: const EdgeInsets.all(12), child: DropdownButtonFormField<String>(
            key: ValueKey(event.id), initialValue: event.id, decoration: const InputDecoration(labelText: 'Public Event'),
            items: events.map((item) => DropdownMenuItem(value: item.id, child: Text(item.name))).toList(),
            onChanged: (value) => setState(() => _eventId = value),
          )),
          Expanded(child: event.routeId == null ? const Center(child: Text('This event has no published route yet.')) : StreamBuilder(
            stream: FirebaseFirestore.instance.collection('routes').doc(event.routeId!).snapshots(),
            builder: (context, routeSnapshot) {
              if (routeSnapshot.hasError) return Center(child: Text('Route unavailable: ${routeSnapshot.error}'));
              if (!routeSnapshot.hasData) return const Center(child: CircularProgressIndicator());
              if (!routeSnapshot.data!.exists) return const Center(child: Text('Route not found.'));
              final route = RouteModel.fromFirestore(routeSnapshot.data!);
              List<LatLng> path = [];
              try { path = PolylineDecoder.decode(route.encodedPolyline); } catch (_) { /* Invalid geometry: no line. */ }
              final colorCode = int.tryParse(route.color.replaceFirst('#', ''), radix: 16) ?? 0xa33b3b;
              return StreamBuilder(
                stream: FirebaseFirestore.instance.collection('stopPoints').where('routeId', isEqualTo: route.id).snapshots(),
                builder: (context, stopSnapshot) {
                  if (stopSnapshot.hasError) return Center(child: Text('Stop points unavailable: ${stopSnapshot.error}'));
                  if (!stopSnapshot.hasData) return const Center(child: CircularProgressIndicator());
                  final stops = stopSnapshot.data!.docs.map(StopPoint.fromFirestore).toList()..sort((a, b) => a.order.compareTo(b.order));
                  final markers = stops.map((stop) => Marker(markerId: MarkerId(stop.id), position: LatLng(stop.latitude, stop.longitude),
                    infoWindow: InfoWindow(title: '${stop.order}. ${stop.name}', snippet: stop.type.name))).toSet();
                  return GoogleMap(key: ValueKey(route.id), initialCameraPosition: CameraPosition(target: path.isNotEmpty ? path.first : (stops.isNotEmpty ? LatLng(stops.first.latitude, stops.first.longitude) : _initialPosition), zoom: 12),
                    markers: markers, polylines: path.length < 2 ? {} : {Polyline(polylineId: PolylineId(route.id), points: path, color: Color(0xff000000 | colorCode), width: 5)},
                    onMapCreated: (controller) => _mapController = controller);
                },
              );
            },
          )),
        ]);
      },
    ));
  }
}
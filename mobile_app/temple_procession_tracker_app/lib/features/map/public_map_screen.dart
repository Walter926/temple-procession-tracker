import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class PublicMapScreen extends StatefulWidget {
  const PublicMapScreen({
    super.key,
  });

  @override
  State<PublicMapScreen> createState() {
    return _PublicMapScreenState();
  }
}

class _PublicMapScreenState extends State<PublicMapScreen> {
  GoogleMapController? _mapController;

  static const LatLng _initialPosition = LatLng(
    49.2827,
    -123.1207,
  );

  static const Marker _testMarker = Marker(
    markerId: MarkerId(
      'test_temple_marker',
    ),
    position: _initialPosition,
    infoWindow: InfoWindow(
      title: 'Test Procession Marker',
      snippet: 'Google Maps setup is working.',
    ),
  );

  @override
  void dispose() {
    _mapController?.dispose();
    super.dispose();
  }

  void _onMapCreated(
    GoogleMapController controller,
  ) {
    _mapController = controller;
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Public Procession Map',
        ),
      ),
      body: GoogleMap(
        initialCameraPosition: const CameraPosition(
          target: _initialPosition,
          zoom: 13,
        ),
        markers: {
          _testMarker,
        },
        onMapCreated: _onMapCreated,
      ),
    );
  }
}
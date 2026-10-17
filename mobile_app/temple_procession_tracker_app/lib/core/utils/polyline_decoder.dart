import 'package:google_maps_flutter/google_maps_flutter.dart';

class PolylineDecoder {
  static List<LatLng> decode(String encoded) {
    final List<LatLng> points = [];
    int index = 0;
    int latitude = 0;
    int longitude = 0;
    int readDelta() {
      int result = 0;
      int shift = 0;
      int chunk;
      do {
        if (index >= encoded.length) throw const FormatException('Invalid polyline');
        chunk = encoded.codeUnitAt(index++) - 63;
        if (chunk < 0 || chunk > 63 || shift > 30) throw const FormatException('Invalid polyline');
        result |= (chunk & 31) << shift;
        shift += 5;
      } while (chunk >= 32);
      return (result & 1) != 0 ? ~(result >> 1) : result >> 1;
    }
    while (index < encoded.length) {
      latitude += readDelta();
      longitude += readDelta();
      points.add(LatLng(latitude / 1e5, longitude / 1e5));
    }
    return points;
  }

  const PolylineDecoder._();
}
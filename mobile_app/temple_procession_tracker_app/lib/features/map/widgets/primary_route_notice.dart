import 'package:flutter/material.dart';

/// Missing references are not permission to select a different route locally.
class PrimaryRouteNotice extends StatelessWidget {
  final bool? hasRoutes;
  const PrimaryRouteNotice({super.key, this.hasRoutes});
  @override
  Widget build(BuildContext context) => Text(
    hasRoutes == false
        ? 'No routes have been created yet. The first route becomes primary automatically.'
        : hasRoutes == true
        ? 'Routes exist, but the primary route is still synchronizing. Ask the organizer to check route synchronization if this continues.'
        : 'The primary route is not available yet. Routes are selected automatically unless the organizer makes a manual choice. Ask the organizer to check route synchronization if this continues.',
  );
}

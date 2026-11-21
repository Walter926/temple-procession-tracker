import 'package:flutter/material.dart';

import 'event_list_screen.dart';

class AdminEventManagementScreen extends StatelessWidget {
  const AdminEventManagementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const EventListScreen(management: true);
  }
}

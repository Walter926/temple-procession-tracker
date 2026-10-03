import 'package:flutter/material.dart';

import '../../shared/widgets/app_card.dart';

class AdminEventManagementScreen extends StatelessWidget {
  const AdminEventManagementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin Event Management')),
      body: const Padding(padding: EdgeInsets.all(24), child: AppCard(child: Text('Event-management tools will be implemented in a later phase.'))),
    );
  }
}
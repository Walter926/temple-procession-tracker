import 'package:flutter/material.dart';

import '../../shared/widgets/app_card.dart';

class EventListScreen extends StatelessWidget {
  const EventListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Events')),
      body: const Padding(padding: EdgeInsets.all(24), child: AppCard(child: Center(child: Text('No Events Loaded Yet')))),
    );
  }
}
import 'package:flutter/material.dart';

import '../../shared/widgets/app_card.dart';

class GroupMapScreen extends StatelessWidget {
  const GroupMapScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Group Map')),
      body: const Padding(
        padding: EdgeInsets.all(24),
        child: AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Live Group Markers', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              SizedBox(height: 16),
              Text('Group A'),
              Text('Group B'),
              Text('Group C'),
              SizedBox(height: 16),
              Text('Real group locations will be added in Phases 27–28.'),
            ],
          ),
        ),
      ),
    );
  }
}
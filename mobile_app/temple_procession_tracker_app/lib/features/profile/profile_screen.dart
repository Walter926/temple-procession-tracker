import 'package:flutter/material.dart';

import '../../shared/widgets/app_card.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          CircleAvatar(radius: 44, child: Icon(Icons.person, size: 44)),
          SizedBox(height: 24),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Display Name', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('Not loaded yet'),
                SizedBox(height: 16),
                Text('Email', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('Not loaded yet'),
                SizedBox(height: 16),
                Text('Role', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('Not loaded yet'),
                SizedBox(height: 16),
                Text('Profile Picture', style: TextStyle(fontWeight: FontWeight.bold)),
                Text('Not loaded yet'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
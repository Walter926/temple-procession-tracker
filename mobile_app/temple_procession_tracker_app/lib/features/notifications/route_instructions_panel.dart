import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class RouteInstructionsPanel extends StatelessWidget {
  const RouteInstructionsPanel({super.key});
  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return const SizedBox.shrink();
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(stream: FirebaseFirestore.instance.collection('routeInstructions').where('uid', isEqualTo: uid).snapshots(), builder: (context, snap) {
      if (snap.hasError) return Text('Route instructions unavailable: ${snap.error}');
      final docs = snap.data?.docs ?? [];
      return Column(children: docs.map((doc) => Card(child: ListTile(leading: const Icon(Icons.alt_route), title: Text('${doc.data()['kind'] ?? 'Route instruction'}'), subtitle: Text('${doc.data()['message'] ?? ''}')))).toList());
    });
  }
}
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

class CollisionWarningsPanel extends StatelessWidget {
  const CollisionWarningsPanel({super.key});
  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return const SizedBox.shrink();
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance.collection('collisionWarnings').where('uid', isEqualTo: uid).snapshots(),
      builder: (context, snapshot) {
        if (snapshot.hasError) return Text('Warnings unavailable: ${snapshot.error}', style: const TextStyle(color: Colors.orange));
        final items = (snapshot.data?.docs ?? []).where((d) => d.data()['state'] == 'unread').toList();
        if (items.isEmpty) return const SizedBox.shrink();
        return Column(children: items.map((doc) => Card(child: ListTile(
          leading: const Icon(Icons.warning_amber_rounded, color: Colors.deepOrange),
          title: const Text('Collision instruction'), subtitle: Text('${doc.data()['message'] ?? ''}'),
          trailing: TextButton(onPressed: () async {
            try { await FirebaseFunctions.instanceFor(region: 'us-central1').httpsCallable('acknowledgeCollisionWarning').call(<String, dynamic>{'warningId': doc.id}); }
            on FirebaseFunctionsException catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message ?? error.code))); }
          }, child: const Text('Acknowledge')),
        ))).toList());
      },
    );
  }
}
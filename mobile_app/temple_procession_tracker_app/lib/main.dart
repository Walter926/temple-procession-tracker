import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'features/map/public_map_screen.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  runApp(
    const TempleProcessionTrackerApp(),
  );
}

class TempleProcessionTrackerApp extends StatelessWidget {
  const TempleProcessionTrackerApp({
    super.key,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return MaterialApp(
      title: 'Temple Procession Tracker',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: Colors.deepOrange,
      ),
      home: const AppEntryScreen(),
    );
  }
}

class AppEntryScreen extends StatelessWidget {
  const AppEntryScreen({
    super.key,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Temple Procession Tracker',
        ),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(
            24,
          ),
          child: Column(
            mainAxisAlignment:
                MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.temple_buddhist,
                size: 80,
              ),
              const SizedBox(
                height: 24,
              ),
              const Text(
                'GPS-Based Temple Procession Tracking App',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(
                height: 16,
              ),
              const Text(
                'Follow temple procession routes, stop points, group locations, and event status in real time.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 16,
                ),
              ),
              const SizedBox(
                height: 32,
              ),
              FilledButton(
                onPressed: () {
                  Navigator.of(
                    context,
                  ).push(
                    MaterialPageRoute<void>(
                      builder: (
                        context,
                      ) {
                        return const PublicMapScreen();
                      },
                    ),
                  );
                },
                child: const Text(
                  'View Public Map',
                ),
              ),
              const SizedBox(
                height: 12,
              ),
              const FilledButton(
                onPressed: null,
                child: Text(
                  'Join with Access Code',
                ),
              ),
              const SizedBox(
                height: 12,
              ),
              const OutlinedButton(
                onPressed: null,
                child: Text(
                  'Organizer Dashboard',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
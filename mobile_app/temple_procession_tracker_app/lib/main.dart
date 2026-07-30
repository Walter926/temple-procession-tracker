import 'package:flutter/material.dart';

void main() {
  runApp(const TempleProcessionTrackerApp());
}

class TempleProcessionTrackerApp extends StatelessWidget {
  const TempleProcessionTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
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
  const AppEntryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Temple Procession Tracker'),
      ),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.temple_buddhist,
                size: 80,
              ),
              SizedBox(height: 24),
              Text(
                'GPS-Based Temple Procession Tracking App',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              SizedBox(height: 16),
              Text(
                'Follow temple procession routes, stop points, group locations, and event status in real time.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16),
              ),
              SizedBox(height: 32),
              FilledButton(
                onPressed: null,
                child: Text('Join with Access Code'),
              ),
              SizedBox(height: 12),
              OutlinedButton(
                onPressed: null,
                child: Text('Organizer Dashboard'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

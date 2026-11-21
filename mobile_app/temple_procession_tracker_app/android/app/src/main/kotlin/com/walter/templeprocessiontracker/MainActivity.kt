package com.walter.templeprocessiontracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "procession_alerts",
                "Procession updates",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Group instructions, collision warnings, and event announcements"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}

import java.util.Properties

plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.android.libraries.mapsplatform.secrets-gradle-plugin") 
}

val releaseSigningFile = rootProject.file("key.properties")
val releaseSigning = Properties().apply {
    if (releaseSigningFile.exists()) releaseSigningFile.inputStream().use { load(it) }
}
val releaseRequested = gradle.startParameter.taskNames.any {
    it.contains("Release", ignoreCase = true)
}
val mapsProperties = Properties().apply {
    val mapsFile = rootProject.file("secrets.properties")
    if (mapsFile.exists()) mapsFile.inputStream().use { load(it) }
}
val mapsKey = mapsProperties.getProperty("MAPS_API_KEY", "").trim()
val mapsConfigured = mapsKey.length >= 20 && !mapsKey.contains("YOUR_") && !mapsKey.contains("PLACEHOLDER")
val allowUnconfiguredMaps = providers.gradleProperty("allowUnconfiguredMaps").orNull == "true"
require(mapsConfigured || (allowUnconfiguredMaps && !releaseRequested)) {
    "Android Maps requires MAPS_API_KEY in android/secrets.properties. Use an Android-restricted key for this package and signing SHA-1. Compile-only debug CI may explicitly pass -PallowUnconfiguredMaps=true; release builds cannot bypass this check."
}
if (releaseRequested) {
    require(listOf("storeFile", "storePassword", "keyAlias", "keyPassword").all {
        !releaseSigning.getProperty(it).isNullOrBlank()
    }) { "Release signing requires android/key.properties. Debug signing is not allowed for releases." }
}

android {
    namespace = "com.walter.templeprocessiontracker"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.walter.templeprocessiontracker"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseSigningFile.exists()) {
            create("release") {
                storeFile = file(releaseSigning.getProperty("storeFile"))
                storePassword = releaseSigning.getProperty("storePassword")
                keyAlias = releaseSigning.getProperty("keyAlias")
                keyPassword = releaseSigning.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

secrets {
    propertiesFileName = "secrets.properties"
    defaultPropertiesFileName = "secrets.defaults.properties"
}

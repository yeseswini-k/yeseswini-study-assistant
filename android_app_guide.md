# Yeseswini's AI Study Assistant - Android App Packaging Guide

This guide details the best free approach to convert the React/Vite web interface of **Yeseswini's AI Study Assistant** into a mobile Android application using **Capacitor** by Ionic.

---

## ⚡ Why Capacitor?
* **100% Free and Open-Source:** No paid subscription, no proprietary platform locks.
* **Hybrid Wrapper:** Runs the compiled React code inside a highly optimized native Android WebView container.
* **Native Extensibility:** Supports plugins to easily access hardware like notifications, local camera, or device storage.
* **Store-Ready:** Compiles into standard Gradle projects that output `.apk` and `.aab` packages for direct installation or deployment on the Google Play Store.

---

## 🛠️ Step-by-Step Setup

Follow these commands from the `frontend/` directory to configure, build, and package the Android app.

### Step 1: Install Capacitor Dependencies
Open your terminal inside the `frontend` folder and install the core Capacitor packages:
```bash
cd frontend
npm install @capacitor/core @capacitor/cli
```

### Step 2: Initialize Capacitor Config
Initialize the project settings. This will prompt you for an App Name and Package ID (reverse-domain style):
```bash
npx cap init "Yeseswini's AI Study Assistant" "com.yeseswini.studyassistant" --web-dir=dist
```
*Note: Make sure `--web-dir=dist` is specified, as Vite builds compilation outputs to the `dist` folder.*

### Step 3: Add the Android Platform
Install the Capacitor Android container and append the platform directories:
```bash
npm install @capacitor/android
npx cap add android
```
This command creates a standard `android` subfolder containing the Java/Kotlin Gradle projects.

### Step 4: Configure Production API URL
Before building, make sure your production backend URL is specified. In the phone application, you cannot easily connect to `localhost`. 
Update the `VITE_API_URL` environment variable to point to your hosted backend (e.g. Render/Railway):
```bash
# Create a production environment variable file
echo "VITE_API_URL=https://your-backend-url.onrender.com" > .env.production
```

### Step 5: Build and Synchronize Web Assets
Compile the React code into static assets, and copy them directly into the Android native folders:
```bash
npm run build
npx cap sync
```

### Step 6: Run / Build the App in Android Studio
Launch Android Studio with the project workspace loaded:
```bash
npx cap open android
```
1. Once Android Studio finishes indexing, connect your Android device via USB (with USB Debugging enabled) or start a virtual emulator.
2. Click the **Run** button (green play arrow) in Android Studio to build and install the app on your target device.

---

## 📦 Building a Release APK / Bundle

To build a standalone installable `.apk` file without Android Studio running in debug mode:
1. In Android Studio, go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
2. Once complete, click **Locate** in the pop-up notification. The generated APK will be stored under:
   `android/app/build/outputs/apk/debug/app-debug.apk`
3. Transfer this file to your phone and install it directly!

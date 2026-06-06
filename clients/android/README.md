# Brodex — Android client

A native Android app (Kotlin + Jetpack Compose) that connects to your Brodex
agent server and lets you drive it by **voice**. Milestone 1: tap the mic,
speak an instruction, it's transcribed into the prompt box, you send it, and the
agent's work streams back live. Tool-approval requests appear as a dialog.

This is a thin client — all the agent work happens in your Docker container. The
app speaks the same HTTP + WebSocket API as the desktop TUI, with token auth.

## Features (Milestone 1)

- **Voice input** via Android's on-device SpeechRecognizer (tap mic → speak →
  confirm → send).
- **Live streaming** of the agent's transcript (assistant text, tool calls,
  results) over WebSocket.
- **Approval dialog** — Allow once / Allow session / Deny, sent back over the
  socket, so gated tools work from the tablet.
- **Settings** — host (your Tailscale or LAN IP), port, and token, stored
  on-device. Change networks without rebuilding.

### Milestone 2 — screenshot + annotate

- **Screenshot capture:** a background service watches for screenshots you take
  (Power+VolDown). When you take one, the app grabs it and pops a sheet showing
  the image.
- **Annotate:** add instructions by voice or text ("fix this error", "what does
  this mean?"), then send the **image + instructions** to the agent. The agent
  sees the actual screenshot (vision input) and acts on it.
- Works while the app is backgrounded (a foreground service with an ongoing
  "Watching for screenshots" notification).

## Prerequisites

- The Brodex server running with `BRODEX_AUTH_TOKEN` set (see the main README's
  *Remote access* section), reachable from the tablet (Tailscale or same LAN).
- Android Studio (Hedgehog or newer) on your Mac.
- The tablet with USB debugging enabled (already done during debloat).

## Build & install (Android Studio)

1. **Open the project:** Android Studio → *Open* → select
   `brodex/clients/android`. Let Gradle sync (it downloads the SDK bits and
   dependencies the first time — a few minutes).
2. **Connect the tablet** via USB (USB debugging on). It should appear in the
   device dropdown at the top.
3. **Run:** press the green ▶ (Run 'app'). Android Studio builds the APK,
   installs it, and launches it on the tablet.
   - If prompted, **allow microphone permission** when you first tap the mic.
   - On first launch, **allow the media/photos and notification permissions** —
     these let the screenshot watcher run. A "Watching for screenshots"
     notification confirms the service is active.

To build an APK you can install manually instead:
*Build → Build Bundle(s) / APK(s) → Build APK(s)*, then copy the `.apk` from
`app/build/outputs/apk/debug/` to the tablet and open it (allow "install from
unknown sources").

## First run

1. The app opens the **Connection** dialog (or tap the ⚙ icon).
2. Enter:
   - **Host:** your Mac's Tailscale IP (e.g. `100.x.y.z`) — or LAN IP at home.
   - **Port:** `7878` (or your configured port).
   - **Token:** the same `BRODEX_AUTH_TOKEN` from the server's `.env`.
3. **Save & connect.** The status turns green ("Connected").
4. Tap the **mic**, speak (e.g. "list the files in the workspace"), confirm the
   transcription, and press send. The reply streams in. Approve any tool prompts.

## Notes / next milestones

- Keep Tailscale connected on both devices for off-network use.
- Permission mode defaults to **ask**, so you'll get approval dialogs. (A future
  setting can switch to full-access for hands-free voice.)
- **Next:** the iPod (iOS) client, and polish (auto-send option, reconnect).

## Layout

```
clients/android/
├── settings.gradle.kts / build.gradle.kts / gradle.properties
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml          # INTERNET + RECORD_AUDIO, cleartext to LAN/tailnet
│       ├── res/…                         # theme, strings, network-security config
│       └── java/ai/brodex/app/
│           ├── MainActivity.kt           # Compose UI: chat, mic, settings, approval dialog
│           ├── ChatViewModel.kt          # state + drives client/WebSocket
│           ├── BrodexClient.kt           # HTTP + WebSocket, token auth (mirrors the TS client)
│           ├── Protocol.kt               # message models
│           ├── VoiceInput.kt             # SpeechRecognizer wrapper
│           └── Settings.kt               # host/port/token via DataStore
```

package ai.brodex.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import androidx.core.app.NotificationCompat

/**
 * Foreground service that watches MediaStore for new screenshots. When the user
 * takes a screenshot (Power+VolDown), Android writes it to the Screenshots
 * folder; we detect the new image and broadcast its URI so the app can grab it
 * and let the user attach instructions. Runs as a foreground service so it keeps
 * working when the app is backgrounded.
 */
class ScreenshotService : Service() {

    companion object {
        const val ACTION_SCREENSHOT = "ai.brodex.app.SCREENSHOT"
        const val ACTION_OPEN_CAPTURE = "ai.brodex.app.OPEN_CAPTURE"
        const val EXTRA_URI = "uri"
        private const val CHANNEL = "brodex_screenshot"
        private const val CHANNEL_CAPTURE = "brodex_capture"
        private const val NOTIF_ID = 42
    }

    private lateinit var observer: ContentObserver
    private var lastSeenId: Long = -1

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
        // Seed lastSeenId so we don't fire for pre-existing screenshots.
        lastSeenId = latestScreenshot()?.first ?: -1
        observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                checkForNew()
            }
        }
        contentResolver.registerContentObserver(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, observer
        )
    }

    private fun checkForNew() {
        val latest = latestScreenshot() ?: return
        val (id, uri) = latest
        if (id != lastSeenId && id > lastSeenId) {
            lastSeenId = id
            // If the app is open, broadcast so it reacts immediately.
            sendBroadcast(Intent(ACTION_SCREENSHOT).apply {
                setPackage(packageName)
                putExtra(EXTRA_URI, uri.toString())
            })
            // Always post a tappable notification so it works when the app is
            // backgrounded or closed — tapping opens the annotate flow.
            postCaptureNotification(uri)
        }
    }

    /** Find the most recent image whose path/name looks like a screenshot. */
    private fun latestScreenshot(): Pair<Long, Uri>? {
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.RELATIVE_PATH,
            MediaStore.Images.Media.DATE_ADDED,
        )
        val sort = "${MediaStore.Images.Media.DATE_ADDED} DESC"
        contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null, sort
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.RELATIVE_PATH)
            while (cursor.moveToNext()) {
                val name = cursor.getString(nameCol)?.lowercase() ?: ""
                val path = cursor.getString(pathCol)?.lowercase() ?: ""
                val looksLikeScreenshot =
                    path.contains("screenshot") || name.contains("screenshot")
                if (looksLikeScreenshot) {
                    val id = cursor.getLong(idCol)
                    val uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString())
                    return id to uri
                }
            }
        }
        return null
    }

    private fun buildNotification(): android.app.Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Brodex screenshot watch", NotificationManager.IMPORTANCE_LOW)
            )
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Brodex")
            .setContentText("Watching for screenshots")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build()
    }

    private fun postCaptureNotification(uri: Uri) {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_CAPTURE, "Brodex screenshot captured", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        // Tapping launches MainActivity with the screenshot URI.
        val open = Intent(this, MainActivity::class.java).apply {
            action = ACTION_OPEN_CAPTURE
            putExtra(EXTRA_URI, uri.toString())
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = android.app.PendingIntent.getActivity(
            this, uri.hashCode(), open,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(this, CHANNEL_CAPTURE)
            .setContentTitle("Screenshot ready")
            .setContentText("Tap to ask Brodex about it")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        nm.notify(uri.hashCode(), notif)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        contentResolver.unregisterContentObserver(observer)
        super.onDestroy()
    }
}

package ai.brodex.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Load a content:// image, downscale if huge, and return a PNG data URL. */
object ImageUtil {
    private const val MAX_DIM = 1600 // cap longest side to keep payloads reasonable

    fun toDataUrl(context: Context, uri: Uri): String? {
        return try {
            val input = context.contentResolver.openInputStream(uri) ?: return null
            val original = input.use { BitmapFactory.decodeStream(it) } ?: return null
            val scaled = downscale(original)
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.PNG, 90, out)
            val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            "data:image/png;base64,$b64"
        } catch (e: Exception) {
            null
        }
    }

    private fun downscale(bmp: Bitmap): Bitmap {
        val w = bmp.width
        val h = bmp.height
        val longest = maxOf(w, h)
        if (longest <= MAX_DIM) return bmp
        val ratio = MAX_DIM.toFloat() / longest
        return Bitmap.createScaledBitmap(bmp, (w * ratio).toInt(), (h * ratio).toInt(), true)
    }
}

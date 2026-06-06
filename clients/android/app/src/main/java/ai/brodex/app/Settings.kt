package ai.brodex.app

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Connection settings for reaching the Brodex server, persisted on-device. */
data class BrodexSettings(
    val host: String = "",     // e.g. your Mac's Tailscale IP (100.x.y.z) or LAN IP
    val port: String = "7878",
    val token: String = "",
) {
    val baseUrl: String get() = "http://$host:$port"
    val isConfigured: Boolean get() = host.isNotBlank() && port.isNotBlank()
}

private val Context.dataStore by preferencesDataStore(name = "brodex_settings")

class SettingsStore(private val context: Context) {
    private val HOST = stringPreferencesKey("host")
    private val PORT = stringPreferencesKey("port")
    private val TOKEN = stringPreferencesKey("token")

    val settings: Flow<BrodexSettings> = context.dataStore.data.map { p ->
        BrodexSettings(
            host = p[HOST] ?: "",
            port = p[PORT] ?: "7878",
            token = p[TOKEN] ?: "",
        )
    }

    suspend fun save(s: BrodexSettings) {
        context.dataStore.edit { p ->
            p[HOST] = s.host.trim()
            p[PORT] = s.port.trim()
            p[TOKEN] = s.token.trim()
        }
    }
}

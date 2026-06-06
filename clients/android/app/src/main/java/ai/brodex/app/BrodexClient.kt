package ai.brodex.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Kotlin client for the Brodex agent server — the mobile twin of
 * src/tui/api-client.ts. HTTP for session/prompt management (Bearer token),
 * WebSocket for live run events + the approval round-trip (token as ?token=).
 */
class BrodexClient(private val settings: BrodexSettings) {

    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // WS stays open
        .build()
    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun req(path: String): Request.Builder {
        val b = Request.Builder().url(settings.baseUrl + path)
        if (settings.token.isNotBlank()) b.header("Authorization", "Bearer ${settings.token}")
        return b
    }

    // ---- HTTP ----

    suspend fun health(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            http.newCall(req("/health").get().build()).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }

    suspend fun listSessions(): ListSessionsResponse = withContext(Dispatchers.IO) {
        http.newCall(req("/sessions").get().build()).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("listSessions HTTP ${resp.code}")
            json.decodeFromString(ListSessionsResponse.serializer(), resp.body!!.string())
        }
    }

    suspend fun createSession(title: String? = null, cwd: String? = null): CreateSessionResponse =
        withContext(Dispatchers.IO) {
            val fields = buildMap {
                if (title != null) put("title", kotlinx.serialization.json.JsonPrimitive(title))
                if (cwd != null) put("cwd", kotlinx.serialization.json.JsonPrimitive(cwd))
            }
            val body = JsonObject(fields).toString().toRequestBody(JSON)
            http.newCall(req("/session").post(body).build()).execute().use { resp ->
                if (!resp.isSuccessful) throw RuntimeException("createSession HTTP ${resp.code}")
                json.decodeFromString(CreateSessionResponse.serializer(), resp.body!!.string())
            }
        }

    suspend fun sendPrompt(
        sessionId: String,
        prompt: String,
        mode: String,
        images: List<String> = emptyList(),
    ) = withContext(Dispatchers.IO) {
        val fields = buildMap<String, kotlinx.serialization.json.JsonElement> {
            put("prompt", kotlinx.serialization.json.JsonPrimitive(prompt))
            put("mode", kotlinx.serialization.json.JsonPrimitive(mode))
            if (images.isNotEmpty()) {
                put("images", kotlinx.serialization.json.JsonArray(
                    images.map { kotlinx.serialization.json.JsonPrimitive(it) }
                ))
            }
        }
        val payload = JsonObject(fields).toString().toRequestBody(JSON)
        http.newCall(req("/session/$sessionId/prompt").post(payload).build()).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("prompt HTTP ${resp.code}")
        }
    }

    // ---- WebSocket ----

    interface Listener {
        fun onEvent(e: ServerEvent)
        fun onClosed(reason: String)
        fun onFailure(t: Throwable)
    }

    /** Open the live event stream. Returns the socket so callers can send/close. */
    fun connect(listener: Listener): WebSocket {
        val wsBase = settings.baseUrl.replace("http://", "ws://").replace("https://", "wss://")
        val tokenQ = if (settings.token.isNotBlank()) "?token=${settings.token}" else ""
        val request = Request.Builder().url("$wsBase/ws$tokenQ").build()
        return http.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { parseEvent(text) }.getOrNull()?.let { listener.onEvent(it) }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed(reason)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = listener.onFailure(t)
        })
    }

    /** Send an approval decision back over the socket. */
    fun approve(ws: WebSocket, requestId: String, decision: String) {
        val msg = JsonObject(
            mapOf(
                "type" to kotlinx.serialization.json.JsonPrimitive("approval_response"),
                "requestId" to kotlinx.serialization.json.JsonPrimitive(requestId),
                "decision" to kotlinx.serialization.json.JsonPrimitive(decision),
            )
        ).toString()
        ws.send(msg)
    }

    private fun parseEvent(text: String): ServerEvent {
        val o = json.parseToJsonElement(text) as JsonObject
        fun str(k: String) = o[k]?.jsonPrimitive?.contentOrNull
        fun num(k: String) = o[k]?.jsonPrimitive?.intOrNull
        return ServerEvent(
            type = str("type") ?: "unknown",
            sessionId = str("sessionId"),
            text = str("text"),
            toolName = str("toolName"),
            args = str("args"),
            result = str("result"),
            detail = str("detail"),
            error = str("error"),
            requestId = str("requestId"),
            inputTokens = num("inputTokens"),
            outputTokens = num("outputTokens"),
        )
    }
}

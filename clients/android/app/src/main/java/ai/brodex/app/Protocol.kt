package ai.brodex.app

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Mirrors src/server/protocol.ts. We parse the "type" field manually (the server
// sends a discriminated union) rather than relying on polymorphic serialization,
// to keep this robust against unknown future message types.

@Serializable
data class CreateSessionResponse(val id: String, val title: String = "", val cwd: String? = null)

@Serializable
data class SessionSummary(
    val id: String,
    val title: String = "",
    val timeUpdated: Long = 0,
    val tokensInput: Int = 0,
    val tokensOutput: Int = 0,
    val agent: String? = null,
)

@Serializable
data class ListSessionsResponse(val sessions: List<SessionSummary> = emptyList(), val activeId: String? = null)

/** A parsed server WebSocket message (only the fields the app uses). */
data class ServerEvent(
    val type: String,
    val sessionId: String? = null,
    val text: String? = null,
    val toolName: String? = null,
    val args: String? = null,
    val result: String? = null,
    val detail: String? = null,
    val error: String? = null,
    val requestId: String? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
)

package ai.brodex.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.WebSocket

/** One line in the transcript. */
data class TranscriptItem(val kind: String, val text: String)

/** A pending approval the user must answer. */
data class PendingApproval(val requestId: String, val toolName: String, val args: String)

data class ChatUiState(
    val connected: Boolean = false,
    val running: Boolean = false,
    val statusText: String = "Not connected",
    val transcript: List<TranscriptItem> = emptyList(),
    val pending: PendingApproval? = null,
    val sessionId: String? = null,
    /** A captured screenshot (data URL) awaiting instructions. */
    val pendingScreenshot: String? = null,
)

class ChatViewModel : ViewModel() {

    private val _ui = MutableStateFlow(ChatUiState())
    val ui: StateFlow<ChatUiState> = _ui.asStateFlow()

    private var client: BrodexClient? = null
    private var ws: WebSocket? = null

    /** Connect: health check, open WS, ensure a session exists. */
    fun connect(settings: BrodexSettings) {
        if (!settings.isConfigured) {
            update { it.copy(statusText = "Not configured (host='${settings.host}', port='${settings.port}')") }
            return
        }
        val c = BrodexClient(settings)
        client = c
        update { it.copy(statusText = "Connecting to ${settings.baseUrl}…") }
        viewModelScope.launch {
            val ok = c.health()
            if (!ok) {
                update { it.copy(connected = false, statusText = "Cannot reach server. Check IP/token/Tailscale.") }
                return@launch
            }
            // Reuse the active session or create one.
            val sessions = runCatching { c.listSessions() }.getOrNull()
            val sid = sessions?.activeId
                ?: sessions?.sessions?.firstOrNull()?.id
                ?: runCatching { c.createSession("mobile").id }.getOrNull()
            update { it.copy(sessionId = sid) }
            openSocket(c)
        }
    }

    private fun openSocket(c: BrodexClient) {
        ws = c.connect(object : BrodexClient.Listener {
            override fun onEvent(e: ServerEvent) = handleEvent(e)
            override fun onClosed(reason: String) = update { it.copy(connected = false, statusText = "Disconnected") }
            override fun onFailure(t: Throwable) =
                update { it.copy(connected = false, statusText = "Connection error: ${t.message}") }
        })
        update { it.copy(connected = true, statusText = "Connected") }
    }

    private fun handleEvent(e: ServerEvent) {
        when (e.type) {
            "hello" -> {}
            "run_started" -> update { it.copy(running = true) }
            "assistant_text" -> addItem("assistant", e.text ?: "")
            "tool_call" -> addItem("tool", "⚙ ${e.toolName} ${truncate(e.args ?: "", 120)}")
            "tool_result" -> addItem("result", truncate(e.result ?: "", 400))
            "denied" -> addItem("note", "⛔ ${e.toolName}: ${e.detail}")
            "approval_request" -> update {
                it.copy(pending = PendingApproval(e.requestId ?: "", e.toolName ?: "", e.args ?: ""))
            }
            "usage" -> {}
            "run_done" -> update { it.copy(running = false) }
            "run_error" -> { addItem("error", e.error ?: "error"); update { it.copy(running = false) } }
        }
    }

    fun sendPrompt(prompt: String, mode: String = "ask", images: List<String> = emptyList()) {
        val c = client ?: return
        val sid = _ui.value.sessionId ?: return
        addItem("user", if (images.isNotEmpty()) "[screenshot] $prompt" else prompt)
        update { it.copy(running = true, pendingScreenshot = null) }
        viewModelScope.launch {
            runCatching { c.sendPrompt(sid, prompt, mode, images) }
                .onFailure { addItem("error", "send failed: ${it.message}"); update { s -> s.copy(running = false) } }
        }
    }

    /** A screenshot was captured; hold it until the user adds instructions. */
    fun onScreenshotCaptured(dataUrl: String) = update { it.copy(pendingScreenshot = dataUrl) }
    fun clearScreenshot() = update { it.copy(pendingScreenshot = null) }

    fun decideApproval(decision: String) {
        val c = client ?: return
        val w = ws ?: return
        val p = _ui.value.pending ?: return
        c.approve(w, p.requestId, decision)
        update { it.copy(pending = null) }
    }

    fun disconnect() {
        ws?.close(1000, "bye"); ws = null
        update { it.copy(connected = false, statusText = "Disconnected") }
    }

    private fun addItem(kind: String, text: String) =
        update { it.copy(transcript = it.transcript + TranscriptItem(kind, text)) }

    private fun update(f: (ChatUiState) -> ChatUiState) {
        _ui.value = f(_ui.value)
    }

    private fun truncate(s: String, n: Int) = if (s.length > n) s.take(n) + "…" else s
}

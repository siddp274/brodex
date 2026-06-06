package ai.brodex.app

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.foundation.Image
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.core.content.ContextCompat
import androidx.compose.ui.graphics.asImageBitmap
import android.graphics.BitmapFactory
import android.util.Base64
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SettingsStore(applicationContext)
        val voice = VoiceInput(applicationContext)
        setContent {
            MaterialTheme {
                BrodexApp(store, voice)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrodexApp(store: SettingsStore, voice: VoiceInput) {
    val vm: ChatViewModel = viewModel()
    val ui by vm.ui.collectAsState()
    val scope = rememberCoroutineScope()

    var settings by remember { mutableStateOf(BrodexSettings()) }
    var showSettings by remember { mutableStateOf(false) }
    var prompt by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }

    // Load settings once; auto-connect if configured.
    LaunchedEffect(Unit) {
        settings = store.settings.first()
        if (settings.isConfigured) vm.connect(settings) else showSettings = true
    }

    val micPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startListening(voice, onText = { prompt = it }, onListening = { listening = it })
    }

    val context = androidx.compose.ui.platform.LocalContext.current

    // Receive screenshot URIs broadcast by ScreenshotService; load + attach.
    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                val uriStr = intent?.getStringExtra(ScreenshotService.EXTRA_URI) ?: return
                val dataUrl = ImageUtil.toDataUrl(context, Uri.parse(uriStr))
                if (dataUrl != null) vm.onScreenshotCaptured(dataUrl)
            }
        }
        val filter = IntentFilter(ScreenshotService.ACTION_SCREENSHOT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
        onDispose { context.unregisterReceiver(receiver) }
    }

    // Request media + notification permissions, then start the watcher service.
    val watchPermissions = androidx.activity.compose.rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { startScreenshotService(context) }

    LaunchedEffect(Unit) {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += Manifest.permission.READ_MEDIA_IMAGES
            perms += Manifest.permission.POST_NOTIFICATIONS
        } else {
            perms += Manifest.permission.READ_EXTERNAL_STORAGE
        }
        watchPermissions.launch(perms.toTypedArray())
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Brodex") },
                actions = {
                    TextButton(onClick = { vm.connect(settings) }) {
                        Text(
                            ui.statusText,
                            color = if (ui.connected) Color(0xFF2E7D32) else Color(0xFFB00020),
                        )
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Filled.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            // Transcript
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp)) {
                items(ui.transcript) { item -> TranscriptRow(item) }
            }

            if (ui.running) LinearProgressIndicator(Modifier.fillMaxWidth())

            // Input row: mic + text + send
            Row(
                Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = {
                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                }) {
                    Icon(Icons.Filled.Mic, contentDescription = "Voice",
                        tint = if (listening) Color(0xFFB00020) else Color.Gray)
                }
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(if (listening) "Listening…" else "Ask Brodex…") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    maxLines = 4,
                )
                IconButton(
                    enabled = prompt.isNotBlank() && ui.sessionId != null && !ui.running,
                    onClick = { vm.sendPrompt(prompt.trim()); prompt = "" },
                ) {
                    Icon(Icons.Filled.Send, contentDescription = "Send")
                }
            }
        }
    }

    // Approval dialog
    ui.pending?.let { p ->
        AlertDialog(
            onDismissRequest = { vm.decideApproval("deny") },
            title = { Text("Approve tool: ${p.toolName}") },
            text = { Text(p.args, modifier = Modifier.verticalScroll(rememberScrollState())) },
            confirmButton = {
                TextButton(onClick = { vm.decideApproval("allow-once") }) { Text("Allow once") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { vm.decideApproval("allow-session") }) { Text("Allow session") }
                    TextButton(onClick = { vm.decideApproval("deny") }) { Text("Deny") }
                }
            }
        )
    }

    // Screenshot annotate sheet — appears when a screenshot is captured.
    ui.pendingScreenshot?.let { dataUrl ->
        ScreenshotAnnotateDialog(
            dataUrl = dataUrl,
            voice = voice,
            onSend = { instructions ->
                vm.sendPrompt(
                    prompt = instructions.ifBlank { "What's in this screenshot? Help me with it." },
                    images = listOf(dataUrl),
                )
            },
            onDismiss = { vm.clearScreenshot() },
        )
    }

    // Settings sheet
    if (showSettings) {
        SettingsDialog(
            initial = settings,
            onSave = { s ->
                settings = s
                scope.launch { store.save(s) }
                showSettings = false
                vm.connect(s)
            },
            onDismiss = { showSettings = false },
        )
    }
}

@Composable
fun TranscriptRow(item: TranscriptItem) {
    val color = when (item.kind) {
        "user" -> Color(0xFF1565C0)
        "assistant" -> Color.Black
        "tool" -> Color(0xFF8D6E00)
        "result" -> Color.DarkGray
        "error" -> Color(0xFFB00020)
        else -> Color.Gray
    }
    val prefix = when (item.kind) { "user" -> "› "; else -> "" }
    Text("$prefix${item.text}", color = color, modifier = Modifier.padding(vertical = 4.dp))
}

@Composable
fun SettingsDialog(initial: BrodexSettings, onSave: (BrodexSettings) -> Unit, onDismiss: () -> Unit) {
    var host by remember { mutableStateOf(initial.host) }
    var port by remember { mutableStateOf(initial.port) }
    var token by remember { mutableStateOf(initial.token) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Connection") },
        text = {
            Column {
                OutlinedTextField(host, { host = it }, label = { Text("Host (Tailscale/LAN IP)") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(port, { port = it }, label = { Text("Port") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(token, { token = it }, label = { Text("Token") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(BrodexSettings(host, port, token)) }) { Text("Save & connect") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

private fun startListening(voice: VoiceInput, onText: (String) -> Unit, onListening: (Boolean) -> Unit) {
    onListening(true)
    voice.start(
        onPartial = { onText(it) },
        onResult = { onText(it) },
        onError = { onListening(false) },
        onEnd = { onListening(false) },
    )
}


@Composable
fun ScreenshotAnnotateDialog(
    dataUrl: String,
    voice: VoiceInput,
    onSend: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var instructions by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    val bitmap = remember(dataUrl) { decodeDataUrl(dataUrl) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Screenshot captured") },
        text = {
            Column {
                bitmap?.let {
                    Image(
                        bitmap = it.asImageBitmap(),
                        contentDescription = "Screenshot",
                        modifier = Modifier.fillMaxWidth().height(220.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {
                        listening = true
                        voice.start(
                            onPartial = { instructions = it },
                            onResult = { instructions = it },
                            onError = { listening = false },
                            onEnd = { listening = false },
                        )
                    }) {
                        Icon(Icons.Filled.Mic, contentDescription = "Voice",
                            tint = if (listening) Color(0xFFB00020) else Color.Gray)
                    }
                    OutlinedTextField(
                        value = instructions,
                        onValueChange = { instructions = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text(if (listening) "Listening…" else "What should I do with this?") },
                        maxLines = 4,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSend(instructions) }) { Text("Send to agent") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Discard") } }
    )
}

private fun decodeDataUrl(dataUrl: String): android.graphics.Bitmap? {
    return try {
        val b64 = dataUrl.substringAfter("base64,", "")
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) { null }
}

private fun startScreenshotService(context: Context) {
    val intent = Intent(context, ScreenshotService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, intent)
    } else {
        context.startService(intent)
    }
}

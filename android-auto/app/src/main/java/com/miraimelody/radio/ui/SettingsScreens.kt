package com.miraimelody.radio.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.miraimelody.radio.data.AnnouncerLanguage
import com.miraimelody.radio.data.AudioQuality
import com.miraimelody.radio.data.BroadcastMode
import com.miraimelody.radio.data.QueueMode
import java.util.Locale

@Composable
fun BroadcastSettingsScreen(viewModel: RadioViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val intervals = remember(
        settings.introInterval,
        settings.outroInterval,
        settings.discussionInterval,
        settings.weatherInterval,
        settings.trafficInterval,
        settings.newsInterval,
        settings.adInterval,
        settings.sponsorInterval,
    ) {
        mutableStateListOf(
            settings.introInterval.toString(),
            settings.outroInterval.toString(),
            settings.discussionInterval.toString(),
            settings.weatherInterval.toString(),
            settings.trafficInterval.toString(),
            settings.newsInterval.toString(),
            settings.adInterval.toString(),
            settings.sponsorInterval.toString(),
        )
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                "Broadcast Settings",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Black,
            )
            Text(
                "Full Radio Show is the default and keeps the complete host sequence.",
                color = Color.White.copy(alpha = .68f),
            )
        }
        item {
            SettingsCard("Programming") {
                EnumChooser(
                    label = "Playback mode",
                    value = settings.broadcastMode,
                    values = BroadcastMode.entries,
                    name = {
                        when (it) {
                            BroadcastMode.FULL_SHOW -> "Full Radio Show"
                            BroadcastMode.CLASSIC -> "Classic Schedule"
                            BroadcastMode.MUSIC_ONLY -> "Music Only"
                        }
                    },
                    onSelected = viewModel::updateBroadcastMode,
                )
                EnumChooser(
                    label = "Local queue",
                    value = settings.queueMode,
                    values = QueueMode.entries,
                    name = { it.name.pretty() },
                    onSelected = viewModel::updateQueueMode,
                )
                EnumChooser(
                    label = "Announcer",
                    value = settings.language,
                    values = AnnouncerLanguage.entries,
                    name = {
                        if (it == AnnouncerLanguage.JAPANESE) "Japanese" else "English"
                    },
                    onSelected = viewModel::updateLanguage,
                )
                EnumChooser(
                    label = "Playback quality",
                    value = settings.quality,
                    values = AudioQuality.entries,
                    name = { it.name.pretty() },
                    onSelected = viewModel::updateQuality,
                )
                Text(
                    when (settings.quality) {
                        AudioQuality.HIGH -> "Best available Opus/AAC bitrate from the backend."
                        AudioQuality.BALANCED -> "Approximately 160 kbps Opus/AAC when available."
                        AudioQuality.DATA_SAVER -> "Approximately 96 kbps Opus/AAC when available."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xff39d4e8),
                )
            }
        }
        if (settings.broadcastMode == BroadcastMode.CLASSIC) {
            item {
                SettingsCard("Classic intervals · songs") {
                    val labels = listOf(
                        "Intro jingle",
                        "Outro jingle",
                        "Discussion",
                        "Weather",
                        "Traffic",
                        "News",
                        "Advertisement",
                        "Sponsor TTS",
                    )
                    labels.chunked(2).forEachIndexed { row, pair ->
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            pair.forEachIndexed { column, label ->
                                val index = row * 2 + column
                                OutlinedTextField(
                                    value = intervals[index],
                                    onValueChange = { value ->
                                        intervals[index] = value.filter(Char::isDigit).take(2)
                                    },
                                    label = { Text(label) },
                                    modifier = Modifier.weight(1f),
                                    singleLine = true,
                                )
                            }
                        }
                    }
                    Button(
                        onClick = {
                            viewModel.updateClassicIntervals(
                                intervals.map { it.toIntOrNull()?.coerceIn(1, 99) ?: 1 }
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Save classic schedule") }
                }
            }
        }
        item {
            SettingsCard("Speech background music") {
                Text("BGM volume: " + (settings.bgmVolume * 100).toInt() + "%")
                Slider(
                    value = settings.bgmVolume,
                    onValueChange = viewModel::updateBgmVolume,
                    valueRange = 0f..0.5f,
                )
                Text(
                    "Default 10% · 1.2s fade-in · 0.6s lead-in · 0.8s tail · 1.2s fade-out",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = .65f),
                )
            }
        }
    }
}

@Composable
fun ConnectionScreen(viewModel: RadioViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val enrolled by viewModel.enrolled.collectAsStateWithLifecycle()
    val cacheBytes by viewModel.cacheBytes.collectAsStateWithLifecycle()
    val playback by viewModel.playbackStatus.collectAsStateWithLifecycle()
    var backendUrl by remember { mutableStateOf(settings.backendUrl) }
    var credential by remember { mutableStateOf("") }
    LaunchedEffect(settings.backendUrl) {
        if (backendUrl.isBlank()) backendUrl = settings.backendUrl
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                "Connection & Cache",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Black,
            )
            Text(
                "The app talks directly to the separately deployed backend. No website is used.",
                color = Color.White.copy(alpha = .68f),
            )
        }
        item {
            SettingsCard("Device enrollment") {
                Text(
                    if (enrolled) "Enrolled on this phone" else "Enrollment required for AI and streams",
                    color = if (enrolled) Color(0xff39d4e8) else Color(0xffff866f),
                    fontWeight = FontWeight.Bold,
                )
                OutlinedTextField(
                    value = backendUrl,
                    onValueChange = { backendUrl = it },
                    label = { Text("Backend URL") },
                    placeholder = { Text("https://radio-backend.example.com") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = credential,
                    onValueChange = { credential = it },
                    label = { Text("Device enrollment credential") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        viewModel.enroll(backendUrl, credential)
                        credential = ""
                    },
                    enabled = backendUrl.isNotBlank() && credential.length >= 16,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (enrolled) "Re-enroll device" else "Enroll device") }
                if (enrolled) {
                    OutlinedButton(
                        onClick = viewModel::revokeLocalCredential,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Remove credential from this phone") }
                }
            }
        }
        item {
            SettingsCard("Offline behavior") {
                Text(
                    playback.message,
                    color = if (playback.offline) Color(0xffff866f) else Color(0xff39d4e8),
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "Local music, jingles, ads, artwork, and BGM continue in airplane mode. " +
                        "YouTube and live radio are streamed and never downloaded.",
                    color = Color.White.copy(alpha = .68f),
                )
            }
        }
        item {
            SettingsCard("Generated audio cache") {
                Text(
                    formatBytes(cacheBytes) + " used of 250 MB",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    "Least-recently-used generated speech and remote metadata. " +
                        "News/traffic expire after 2 hours; weather after 6.",
                    color = Color.White.copy(alpha = .68f),
                )
                OutlinedButton(
                    onClick = viewModel::clearCache,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Clear generated cache") }
            }
        }
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xff0e2033)),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun <T> EnumChooser(
    label: String,
    value: T,
    values: List<T>,
    name: (T) -> String,
    onSelected: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(name(value), modifier = Modifier.weight(1f)) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            values.forEach { item ->
                DropdownMenuItem(
                    text = { Text(name(item)) },
                    onClick = {
                        expanded = false
                        onSelected(item)
                    },
                )
            }
        }
    }
}

private fun String.pretty(): String =
    lowercase(Locale.ROOT).replace('_', ' ').replaceFirstChar(Char::uppercase)

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
    bytes >= 1024L -> String.format(Locale.US, "%.1f KB", bytes / 1024.0)
    else -> bytes.toString() + " B"
}

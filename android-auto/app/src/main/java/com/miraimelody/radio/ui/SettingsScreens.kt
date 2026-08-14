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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
    var newsFocus by remember(settings.newsFocus) { mutableStateOf(settings.newsFocus) }
    val intervals = remember(
        settings.frequency,
        settings.newsEvery,
        settings.trafficEvery,
        settings.jingleEvery,
        settings.adEvery,
    ) {
        mutableStateListOf(
            settings.frequency.toString(),
            settings.newsEvery.toString(),
            settings.trafficEvery.toString(),
            settings.jingleEvery.toString(),
            settings.adEvery.toString(),
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
                SettingSwitch(
                    label = "Audio normalization",
                    checked = settings.audioNormalization,
                    onCheckedChange = viewModel::updateAudioNormalization,
                )
            }
        }
        item {
            SettingsCard("AI host") {
                SettingSwitch(
                    label = "Enable AI host",
                    checked = settings.hostEnabled,
                    onCheckedChange = viewModel::updateHostEnabled,
                )
                SettingSwitch(
                    label = "Song discussion",
                    checked = settings.chatterEnabled,
                    enabled = settings.hostEnabled,
                    onCheckedChange = viewModel::updateChatterEnabled,
                )
                SettingSwitch(
                    label = "Web-researched song trivia",
                    checked = settings.researchedChatter,
                    enabled = settings.hostEnabled && settings.chatterEnabled,
                    onCheckedChange = viewModel::updateResearchedChatter,
                )
                SettingSwitch(
                    label = "DJ memory",
                    checked = settings.djMemoryEnabled,
                    enabled = settings.hostEnabled && settings.chatterEnabled,
                    onCheckedChange = viewModel::updateDjMemoryEnabled,
                )
                SettingSwitch(
                    label = "Listener-style interaction",
                    checked = settings.listenerInteractionEnabled,
                    enabled = settings.hostEnabled && settings.chatterEnabled,
                    onCheckedChange = viewModel::updateListenerInteractionEnabled,
                )
                OutlinedTextField(
                    value = newsFocus,
                    onValueChange = { newsFocus = it.take(160) },
                    label = { Text("News focus") },
                    placeholder = { Text("Japan technology, anime industry...") },
                    enabled = settings.hostEnabled,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { viewModel.updateNewsFocus(newsFocus) },
                    enabled = settings.hostEnabled && newsFocus != settings.newsFocus,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Save news focus") }
            }
        }
        item {
            SettingsCard("Station breaks") {
                SettingSwitch(
                    label = "Advertisements in Classic Schedule",
                    checked = settings.adsEnabled,
                    enabled = settings.hostEnabled,
                    onCheckedChange = viewModel::updateAdsEnabled,
                )
                SettingSwitch(
                    label = "Morning news and weather preroll",
                    checked = settings.morningPreroll,
                    enabled = settings.hostEnabled,
                    onCheckedChange = viewModel::updateMorningPreroll,
                )
                SettingSwitch(
                    label = "Noon news and weather preroll",
                    checked = settings.noonPreroll,
                    enabled = settings.hostEnabled,
                    onCheckedChange = viewModel::updateNoonPreroll,
                )
            }
        }
        if (settings.broadcastMode == BroadcastMode.CLASSIC) {
            item {
                SettingsCard("Classic intervals · songs") {
                    Text("Set 0 to disable News, Traffic, or Jingles.")
                    val labels = listOf(
                        "Speak every",
                        "News every",
                        "Traffic every",
                        "Jingle every",
                        "Advertisement every",
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
                                listOf(
                                    intervals[0].toIntOrNull()?.coerceIn(1, 5) ?: 1,
                                    intervals[1].toIntOrNull()?.coerceIn(0, 10) ?: 0,
                                    intervals[2].toIntOrNull()?.coerceIn(0, 20) ?: 0,
                                    intervals[3].toIntOrNull()?.coerceIn(0, 10) ?: 0,
                                    intervals[4].toIntOrNull()?.coerceIn(1, 20) ?: 1,
                                )
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
                    "Uses local BGM when selected, otherwise streams the station BGM with a packaged fallback. " +
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
private fun SettingSwitch(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
        )
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

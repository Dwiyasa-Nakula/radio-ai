package com.miraimelody.radio.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.miraimelody.radio.data.SourceEntity
import com.miraimelody.radio.data.SourceType

@Composable
fun SourcesScreen(viewModel: RadioViewModel) {
    val sources by viewModel.sources.collectAsStateWithLifecycle()
    var playlist by remember { mutableStateOf("") }
    var adLink by remember { mutableStateOf("") }
    var pendingFolder by remember { mutableStateOf<SourceType?>(null) }
    val folderLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        val type = pendingFolder
        pendingFolder = null
        if (uri != null && type != null) viewModel.addFolder(type, uri)
    }
    val bgmFileLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri != null) viewModel.addBgmFile(uri)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                "Sources",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Black,
            )
            Text(
                "Folders remain private on this phone through Android's document picker.",
                color = Color.White.copy(alpha = .68f),
            )
        }
        item {
            SectionCard("Music") {
                OutlinedTextField(
                    value = playlist,
                    onValueChange = { playlist = it },
                    label = { Text("YouTube playlist ID") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        viewModel.addYouTubePlaylist(playlist)
                        playlist = ""
                    },
                    enabled = playlist.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Add YouTube playlist") }
                FolderButton("Choose on-device music folder") {
                    pendingFolder = SourceType.MUSIC_FOLDER
                    folderLauncher.launch(null)
                }
            }
        }
        item {
            SectionCard("Jingles, ads, and BGM") {
                FolderButton("Choose intro jingle folder") {
                    pendingFolder = SourceType.INTRO_JINGLE_FOLDER
                    folderLauncher.launch(null)
                }
                FolderButton("Choose outro jingle folder") {
                    pendingFolder = SourceType.OUTRO_JINGLE_FOLDER
                    folderLauncher.launch(null)
                }
                FolderButton("Choose advertisement folder") {
                    pendingFolder = SourceType.AD_FOLDER
                    folderLauncher.launch(null)
                }
                FolderButton("Choose BGM folder") {
                    pendingFolder = SourceType.BGM_FOLDER
                    folderLauncher.launch(null)
                }
                OutlinedButton(
                    onClick = { bgmFileLauncher.launch(arrayOf("audio/*", "video/mp4")) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.VideoFile, null)
                    Text("  Choose one BGM file")
                }
                OutlinedTextField(
                    value = adLink,
                    onValueChange = { adLink = it },
                    label = { Text("YouTube advertisement link") },
                    supportingText = { Text("The app validates and saves the title—no text/JSON file.") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        viewModel.addYouTubeAd(adLink)
                        adLink = ""
                    },
                    enabled = adLink.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Validate and add YouTube ad") }
            }
        }
        item {
            SectionCard("Live radio") {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    RadioButton("Japan", SourceType.RADIO_JP, viewModel, Modifier.weight(1f))
                    RadioButton("China", SourceType.RADIO_CN, viewModel, Modifier.weight(1f))
                    RadioButton("Korea", SourceType.RADIO_KR, viewModel, Modifier.weight(1f))
                }
            }
        }
        item {
            Text(
                "Configured sources",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
        if (sources.isEmpty()) {
            item { Text("No sources yet. Local folders work without enrollment.") }
        } else {
            items(sources, key = SourceEntity::id) { source ->
                SourceRow(
                    source,
                    onRefresh = { viewModel.refresh(source) },
                    onDelete = { viewModel.remove(source) },
                )
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
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
private fun FolderButton(label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.Folder, null)
        Text("  " + label)
    }
}

@Composable
private fun RadioButton(
    label: String,
    type: SourceType,
    viewModel: RadioViewModel,
    modifier: Modifier,
) {
    OutlinedButton(onClick = { viewModel.addRadio(type) }, modifier = modifier) {
        Text(label)
    }
}

@Composable
private fun SourceRow(
    source: SourceEntity,
    onRefresh: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xff0e2033)),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(source.label, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    source.type.name.replace('_', ' ').lowercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xff39d4e8),
                )
                Text(
                    source.value,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = .55f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh") }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Delete", tint = Color(0xffff866f))
            }
        }
    }
}

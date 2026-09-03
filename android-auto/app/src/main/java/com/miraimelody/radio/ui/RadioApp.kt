package com.miraimelody.radio.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Source
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.miraimelody.radio.R
import com.miraimelody.radio.data.TrackEntity

private val Ink = Color(0xff08111d)
private val Navy = Color(0xff0e2033)
private val Cyan = Color(0xff39d4e8)
private val Coral = Color(0xffff866f)
private val Paper = Color(0xffeef7f8)

enum class AppTab(val label: String, val icon: ImageVector) {
    NOW_PLAYING("Playing", Icons.Default.LibraryMusic),
    SOURCES("Sources", Icons.Default.Source),
    QUEUE("Queue", Icons.Default.QueueMusic),
    BROADCAST("Broadcast", Icons.Default.Settings),
    CONNECTION("Connect", Icons.Default.Cloud),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RadioApp(viewModel: RadioViewModel) {
    var tab by remember { mutableStateOf(AppTab.NOW_PLAYING) }
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            viewModel.dismissMessage()
        }
    }
    MaterialTheme(
        colorScheme = androidx.compose.material3.darkColorScheme(
            primary = Cyan,
            secondary = Coral,
            background = Ink,
            surface = Navy,
            onPrimary = Ink,
            onBackground = Paper,
            onSurface = Paper,
        )
    ) {
        Scaffold(
            containerColor = Ink,
            topBar = {
                TopAppBar(
                    navigationIcon = {
                        Image(
                            painter = painterResource(R.drawable.mirai_melody_logo),
                            contentDescription = "mirAI melody logo",
                            modifier = Modifier.size(42.dp),
                            contentScale = ContentScale.Fit,
                        )
                    },
                    title = {
                        Column {
                            Text("mirAI melody", fontWeight = FontWeight.Black)
                            Text(
                                "73.9 FM · native radio",
                                style = MaterialTheme.typography.labelSmall,
                                color = Cyan,
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Ink),
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar(containerColor = Navy) {
                    AppTab.entries.forEach { item ->
                        NavigationBarItem(
                            selected = tab == item,
                            onClick = { tab = item },
                            icon = { Icon(item.icon, item.label) },
                            label = { Text(item.label, maxLines = 1) },
                        )
                    }
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when (tab) {
                    AppTab.NOW_PLAYING -> NowPlayingScreen(viewModel)
                    AppTab.SOURCES -> SourcesScreen(viewModel)
                    AppTab.QUEUE -> LocalQueueScreen(viewModel)
                    AppTab.BROADCAST -> BroadcastSettingsScreen(viewModel)
                    AppTab.CONNECTION -> ConnectionScreen(viewModel)
                }
            }
        }
    }
}

@Composable
private fun NowPlayingScreen(viewModel: RadioViewModel) {
    val now by viewModel.nowPlaying.collectAsStateWithLifecycle()
    val status by viewModel.playbackStatus.collectAsStateWithLifecycle()
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(260.dp)
                .background(
                    Brush.linearGradient(listOf(Cyan.copy(alpha = .8f), Coral.copy(alpha = .7f), Navy)),
                    RoundedCornerShape(36.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.LibraryMusic,
                contentDescription = null,
                modifier = Modifier.size(96.dp),
                tint = Ink.copy(alpha = .72f),
            )
        }
        Spacer(Modifier.height(28.dp))
        Text(
            now.title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(now.artist, color = Paper.copy(alpha = .7f), maxLines = 1)
        if (now.detail.isNotBlank()) {
            Text(now.detail, style = MaterialTheme.typography.labelMedium, color = Cyan)
        }
        Spacer(Modifier.height(18.dp))
        Text(
            status.message,
            color = if (status.offline) Coral else Cyan,
            style = MaterialTheme.typography.labelLarge,
        )
        Spacer(Modifier.height(20.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = viewModel::previous, enabled = now.canPrevious) {
                Icon(Icons.Default.SkipPrevious, "Previous", modifier = Modifier.size(34.dp))
            }
            FloatingActionButton(
                onClick = viewModel::playPause,
                shape = CircleShape,
                containerColor = Cyan,
                modifier = Modifier.size(70.dp),
            ) {
                Icon(
                    if (now.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    if (now.playing) "Pause" else "Play",
                    modifier = Modifier.size(38.dp),
                )
            }
            IconButton(onClick = viewModel::next, enabled = now.canNext) {
                Icon(Icons.Default.SkipNext, "Next", modifier = Modifier.size(34.dp))
            }
        }
    }
}

@Composable
private fun LocalQueueScreen(viewModel: RadioViewModel) {
    val tracks by viewModel.music.collectAsStateWithLifecycle()
    if (tracks.isEmpty()) {
        EmptyState(
            title = "Your local queue is empty",
            detail = "Add a phone music folder or YouTube playlist from Sources.",
        )
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(
                "Local Queue",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Black,
            )
            Text(
                "Random by default. Favorites receive about 10% extra rotation.",
                color = Paper.copy(alpha = .7f),
            )
            Spacer(Modifier.height(8.dp))
        }
        items(tracks, key = TrackEntity::mediaId) { track ->
            TrackRow(
                track = track,
                onPlay = { viewModel.play(track) },
                onFavorite = { viewModel.toggleFavorite(track) },
                onUp = { viewModel.move(track, -1) },
                onDown = { viewModel.move(track, 1) },
            )
        }
    }
}

@Composable
private fun TrackRow(
    track: TrackEntity,
    onPlay: () -> Unit,
    onFavorite: () -> Unit,
    onUp: () -> Unit,
    onDown: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Navy),
        shape = RoundedCornerShape(18.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onPlay) { Icon(Icons.Default.PlayArrow, "Play") }
            Column(Modifier.weight(1f)) {
                Text(track.title, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    listOf(track.artist, track.technicalDetail).filter(String::isNotBlank)
                        .joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = Paper.copy(alpha = .65f),
                    maxLines = 1,
                )
            }
            IconButton(onClick = onFavorite) {
                Icon(
                    if (track.favoriteRank > 0) Icons.Default.Star else Icons.Outlined.StarBorder,
                    "Favorite",
                    tint = if (track.favoriteRank > 0) Coral else Paper,
                )
            }
            Column {
                IconButton(onClick = onUp, modifier = Modifier.size(30.dp)) {
                    Icon(Icons.Default.ArrowUpward, "Move up")
                }
                IconButton(onClick = onDown, modifier = Modifier.size(30.dp)) {
                    Icon(Icons.Default.ArrowDownward, "Move down")
                }
            }
        }
    }
}

@Composable
fun EmptyState(title: String, detail: String) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Default.LibraryMusic, null, modifier = Modifier.size(64.dp), tint = Cyan)
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(detail, color = Paper.copy(alpha = .7f))
    }
}

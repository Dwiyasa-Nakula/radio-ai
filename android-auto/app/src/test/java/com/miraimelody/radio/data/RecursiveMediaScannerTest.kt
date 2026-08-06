package com.miraimelody.radio.data

import org.junit.Test
import org.junit.Assert.assertEquals

class RecursiveMediaScannerTest {
    private data class Node(
        val name: String,
        val directory: Boolean = false,
        val children: List<Node> = emptyList(),
    )

    @Test
    fun scansEveryMp3BelowTheSelectedRootWithoutDepthOrCountCaps() {
        val deepSong = Node("deep.mp3")
        val deepTree = (1..12).fold(deepSong) { child, depth ->
            Node("level-$depth", directory = true, children = listOf(child))
        }
        val manySongs = (1..2_050).map { Node("song-$it.mp3") }
        val root = Node("root", directory = true, children = manySongs + deepTree + Node("notes.txt"))

        val found = collectMediaRecursively(
            root = root,
            children = Node::children,
            isDirectory = Node::directory,
            isPlayable = { it.name.endsWith(".mp3", ignoreCase = true) },
            sortKey = Node::name,
        )

        assertEquals(2_051, found.size)
        assertEquals(1, found.count { it.name == "deep.mp3" })
    }
}
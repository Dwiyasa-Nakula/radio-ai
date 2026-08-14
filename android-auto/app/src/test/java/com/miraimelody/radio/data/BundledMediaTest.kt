package com.miraimelody.radio.data

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BundledMediaTest {
    @Test
    fun `dual role entry lands in both pools with distinct media ids`() {
        val items = BundledMedia.parse(
            """
            {"items":[{"file":"jingle.mp4","title":"Jingle","roles":["INTRO","OUTRO"]}]}
            """.trimIndent()
        )
        assertEquals(1, items.size)
        assertEquals(listOf(MediaRole.INTRO, MediaRole.OUTRO), items.single().roles)

        val tracks = BundledMedia.tracks(items)
        assertEquals(2, tracks.size)
        assertEquals(
            setOf(BundledMedia.INTRO_SOURCE_ID, BundledMedia.OUTRO_SOURCE_ID),
            tracks.map { it.sourceId }.toSet(),
        )
        assertEquals(2, tracks.map { it.mediaId }.toSet().size)
        assertTrue(tracks.all { it.uri == "asset:///bundled/media/jingle.mp4" })
        assertTrue(tracks.none { it.remote })
    }

    @Test
    fun `unsupported and unknown roles are dropped`() {
        val items = BundledMedia.parse(
            """
            {"items":[
              {"file":"music.mp3","roles":["MUSIC"]},
              {"file":"typo.mp3","roles":["INTROO"]},
              {"file":"empty.mp3","roles":[]},
              {"file":"noroles.mp3"},
              {"file":"ok.mp3","roles":["AD","BGM"]}
            ]}
            """.trimIndent()
        )
        assertEquals(listOf("ok.mp3"), items.map { it.file })
        assertEquals(listOf(MediaRole.AD), items.single().roles)
    }

    @Test
    fun `path traversal and blank file names are rejected`() {
        val items = BundledMedia.parse(
            """
            {"items":[
              {"file":"../secrets.mp3","roles":["AD"]},
              {"file":"nested/file.mp3","roles":["AD"]},
              {"file":"back\\slash.mp3","roles":["AD"]},
              {"file":"  ","roles":["AD"]}
            ]}
            """.trimIndent()
        )
        assertTrue(items.isEmpty())
    }

    @Test
    fun `blank title falls back to the file stem`() {
        val items = BundledMedia.parse(
            """
            {"items":[{"file":"ad-toyota.mp3","title":"  ","roles":["AD"]}]}
            """.trimIndent()
        )
        assertEquals("ad-toyota", items.single().title)
        assertEquals("", items.single().artist)
    }

    @Test
    fun `extensions map to playable mime types`() {
        val items = BundledMedia.parse(
            """
            {"items":[
              {"file":"a.mp3","roles":["AD"]},
              {"file":"b.mp4","roles":["AD"]},
              {"file":"c.m4a","roles":["AD"]},
              {"file":"d.wav","roles":["AD"]},
              {"file":"e.opus","roles":["AD"]},
              {"file":"f.xyz","roles":["AD"]}
            ]}
            """.trimIndent()
        )
        assertEquals(
            listOf("audio/mpeg", "video/mp4", "audio/mp4", "audio/wav", "audio/ogg", ""),
            items.map { it.mimeType },
        )
    }

    @Test
    fun `missing items array yields nothing rather than throwing`() {
        assertTrue(BundledMedia.parse("""{"version":1}""").isEmpty())
    }

    @Test
    fun `queue positions are contiguous within each role`() {
        val tracks = BundledMedia.tracks(
            BundledMedia.parse(
                """
                {"items":[
                  {"file":"one.mp4","roles":["INTRO","OUTRO"]},
                  {"file":"two.mp4","roles":["OUTRO"]},
                  {"file":"ad.mp3","artist":"Acme","roles":["AD"]}
                ]}
                """.trimIndent()
            )
        )
        assertEquals(listOf(0), tracks.filter { it.role == MediaRole.INTRO }.map { it.queuePosition })
        assertEquals(listOf(0, 1), tracks.filter { it.role == MediaRole.OUTRO }.map { it.queuePosition })
        assertEquals("Acme", tracks.single { it.role == MediaRole.AD }.artist)
    }

    /**
     * Reads the real manifest off disk so a typo there fails the build rather than silently
     * shipping an APK with fewer jingles. The working directory of a Gradle test task is not
     * contractual, so walk up until the assets root appears.
     */
    private fun assetsRoot(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "app/src/main/assets")
            if (candidate.isDirectory) return candidate
            val here = File(dir, "src/main/assets")
            if (here.isDirectory) return here
            dir = dir.parentFile
        }
        throw AssertionError("Could not locate src/main/assets from " + File("").absolutePath)
    }

    @Test
    fun `the packaged manifest parses, covers every role, and names files that exist`() {
        val assets = assetsRoot()
        val items = BundledMedia.parse(File(assets, BundledMedia.MANIFEST_PATH).readText())
        assertTrue("manifest parsed to nothing", items.isNotEmpty())

        items.forEach { item ->
            assertTrue(
                "missing asset: " + item.file,
                File(assets, "bundled/media/" + item.file).isFile,
            )
            assertTrue("unplayable mime for " + item.file, item.mimeType.isNotEmpty())
        }

        val tracks = BundledMedia.tracks(items)
        assertTrue(tracks.any { it.role == MediaRole.INTRO })
        assertTrue(tracks.any { it.role == MediaRole.OUTRO })
        assertTrue(tracks.any { it.role == MediaRole.AD })
        assertEquals(tracks.size, tracks.map { it.mediaId }.toSet().size)
    }
}

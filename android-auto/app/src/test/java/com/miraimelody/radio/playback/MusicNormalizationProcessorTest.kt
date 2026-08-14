package com.miraimelody.radio.playback

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicNormalizationProcessorTest {
    @Test
    fun `disabled normalization preserves PCM samples`() {
        val processor = MusicNormalizationProcessor().apply { enabled = false }
        processor.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT))
        processor.flush(AudioProcessor.StreamMetadata.DEFAULT)
        val samples = shortArrayOf(1_000, -1_000, 2_000, -2_000)

        processor.queueInput(pcm(samples))

        assertArrayEquals(samples, shorts(processor.output))
    }

    @Test
    fun `enabled normalization raises quiet PCM without clipping`() {
        val processor = MusicNormalizationProcessor().apply { enabled = true }
        processor.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT))
        processor.flush(AudioProcessor.StreamMetadata.DEFAULT)
        val samples = shortArrayOf(2_000, -2_000, 4_000, -4_000)

        processor.queueInput(pcm(samples))
        val normalized = shorts(processor.output)

        assertTrue(normalized.maxOf { kotlin.math.abs(it.toInt()) } > 4_000)
        assertTrue(normalized.all { it in Short.MIN_VALUE..Short.MAX_VALUE })
    }

    private fun pcm(samples: ShortArray): ByteBuffer =
        ByteBuffer.allocateDirect(samples.size * 2).order(ByteOrder.nativeOrder()).apply {
            samples.forEach(::putShort)
            flip()
        }

    private fun shorts(buffer: ByteBuffer): ShortArray =
        ShortArray(buffer.remaining() / 2) { buffer.order(ByteOrder.nativeOrder()).short }
}

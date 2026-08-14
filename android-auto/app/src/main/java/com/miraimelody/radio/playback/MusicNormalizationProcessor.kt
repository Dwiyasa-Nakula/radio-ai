package com.miraimelody.radio.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.roundToInt

@OptIn(UnstableApi::class)
class MusicNormalizationProcessor : BaseAudioProcessor() {
    @Volatile var enabled: Boolean = false
    private var gain = 1f

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat =
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
            inputAudioFormat
        } else {
            AudioFormat.NOT_SET
        }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val outputBuffer = replaceOutputBuffer(inputBuffer.remaining())
            .order(ByteOrder.nativeOrder())
        if (!enabled) {
            gain = 1f
            outputBuffer.put(inputBuffer)
            outputBuffer.flip()
            return
        }

        val scan = inputBuffer.duplicate().order(ByteOrder.nativeOrder())
        var peak = 0
        while (scan.remaining() >= Short.SIZE_BYTES) {
            peak = maxOf(peak, abs(scan.short.toInt()))
        }
        val targetGain = if (peak == 0) {
            1f
        } else {
            (TARGET_PEAK / peak.toFloat()).coerceIn(MIN_GAIN, MAX_GAIN)
        }
        gain += (targetGain - gain) * SMOOTHING

        inputBuffer.order(ByteOrder.nativeOrder())
        while (inputBuffer.remaining() >= Short.SIZE_BYTES) {
            val normalized = (inputBuffer.short * gain).roundToInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            outputBuffer.putShort(normalized.toShort())
        }
        while (inputBuffer.hasRemaining()) outputBuffer.put(inputBuffer.get())
        outputBuffer.flip()
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        gain = 1f
    }

    companion object {
        private const val TARGET_PEAK = Short.MAX_VALUE * 0.85f
        private const val MIN_GAIN = 0.5f
        private const val MAX_GAIN = 1.5f
        private const val SMOOTHING = 0.15f
    }
}

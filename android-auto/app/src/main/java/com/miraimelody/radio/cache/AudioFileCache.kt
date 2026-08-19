package com.miraimelody.radio.cache

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

class AudioFileCache(
    context: Context,
    private val limitBytes: () -> Long,
) {
    private val directory = File(context.cacheDir, "native-radio-cache").apply { mkdirs() }

    @Synchronized
    fun get(key: String, maxAgeMs: Long? = null): File? {
        val prefix = safePrefix(key) + "-" + digest(key)
        val file = directory.listFiles()
            ?.firstOrNull { it.isFile && it.name.startsWith(prefix) && it.length() > 0 }
            ?: return null
        val now = System.currentTimeMillis()
        if (maxAgeMs != null) {
            if (now - file.lastModified() >= maxAgeMs) {
                file.delete()
                return null
            }
            return file
        }
        file.setLastModified(now)
        return file
    }
    @Synchronized
    fun put(key: String, contentType: String?, bytes: ByteArray): File {
        val target = File(directory, safePrefix(key) + "-" + digest(key) + extension(contentType))
        val temporary = File(directory, target.name + ".part")
        FileOutputStream(temporary).use { it.write(bytes) }
        if (!temporary.renameTo(target)) {
            temporary.copyTo(target, overwrite = true)
            temporary.delete()
        }
        target.setLastModified(System.currentTimeMillis())
        prune()
        return target
    }

    @Synchronized
    fun latest(kind: String, maxAgeMs: Long): File? {
        val now = System.currentTimeMillis()
        return directory.listFiles()
            ?.filter {
                it.isFile && it.name.startsWith(safePrefix(kind) + "-") &&
                    now - it.lastModified() <= maxAgeMs
            }
            ?.maxByOrNull(File::lastModified)
            ?.also { it.setLastModified(now) }
    }

    @Synchronized
    fun transitionFile(): File {
        val target = File(directory, "bundled-transition.wav")
        if (target.length() > 44) return target
        val sampleRate = 8_000
        val samples = sampleRate / 3
        val dataSize = samples * 2
        FileOutputStream(target).use { output ->
            output.write("RIFF".toByteArray())
            writeLittleEndian(output, 36 + dataSize, 4)
            output.write("WAVEfmt ".toByteArray())
            writeLittleEndian(output, 16, 4)
            writeLittleEndian(output, 1, 2)
            writeLittleEndian(output, 1, 2)
            writeLittleEndian(output, sampleRate, 4)
            writeLittleEndian(output, sampleRate * 2, 4)
            writeLittleEndian(output, 2, 2)
            writeLittleEndian(output, 16, 2)
            output.write("data".toByteArray())
            writeLittleEndian(output, dataSize, 4)
            repeat(samples) { index ->
                val envelope = 1.0 - index.toDouble() / samples
                val tone = (kotlin.math.sin(index * 2.0 * Math.PI * 660.0 / sampleRate) *
                    envelope * 900.0).toInt()
                writeLittleEndian(output, tone, 2)
            }
        }
        return target
    }

    @Synchronized
    fun usageBytes(): Long = directory.listFiles()?.sumOf { it.length() } ?: 0

    @Synchronized
    fun clear() {
        directory.listFiles()?.filterNot { it.name == "bundled-transition.wav" }?.forEach(File::delete)
    }

    private fun prune() {
        val files = directory.listFiles()
            ?.filter { it.isFile && it.name != "bundled-transition.wav" }
            ?.sortedBy(File::lastModified)
            ?.toMutableList() ?: return
        var total = files.sumOf(File::length)
        val limit = limitBytes().coerceAtLeast(8L * 1024L * 1024L)
        while (total > limit && files.isNotEmpty()) {
            val oldest = files.removeAt(0)
            total -= oldest.length()
            oldest.delete()
        }
    }

    private fun safePrefix(key: String): String =
        key.substringBefore(':').lowercase().replace(Regex("[^a-z0-9_-]"), "").take(24)
            .ifEmpty { "media" }

    private fun digest(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(32)

    private fun extension(contentType: String?): String = when {
        contentType?.contains("jpeg", true) == true -> ".jpg"
        contentType?.contains("png", true) == true -> ".png"
        contentType?.contains("wav", true) == true -> ".wav"
        contentType?.contains("ogg", true) == true -> ".ogg"
        contentType?.contains("mp4", true) == true -> ".m4a"
        else -> ".mp3"
    }

    private fun writeLittleEndian(output: FileOutputStream, value: Int, bytes: Int) {
        repeat(bytes) { shift -> output.write(value ushr (shift * 8) and 0xff) }
    }
}

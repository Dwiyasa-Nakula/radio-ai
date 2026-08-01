package com.miraimelody.radio.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

enum class SourceType {
    YOUTUBE_PLAYLIST,
    MUSIC_FOLDER,
    RADIO_JP,
    RADIO_CN,
    RADIO_KR,
    INTRO_JINGLE_FOLDER,
    OUTRO_JINGLE_FOLDER,
    AD_FOLDER,
    BGM_FILE,
    BGM_FOLDER,
    YOUTUBE_AD,
}

enum class MediaRole { MUSIC, INTRO, OUTRO, AD, BGM, RADIO }

@Entity(tableName = "sources", indices = [Index("type")])
data class SourceEntity(
    @PrimaryKey val id: String,
    val type: SourceType,
    val label: String,
    val value: String,
    val enabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
    val refreshedAt: Long = 0,
)

@Entity(
    tableName = "tracks",
    indices = [Index("sourceId"), Index("role"), Index("queuePosition")]
)
data class TrackEntity(
    @PrimaryKey val mediaId: String,
    val sourceId: String,
    val role: MediaRole,
    val uri: String,
    val title: String,
    val artist: String = "",
    val album: String = "",
    val durationMs: Long = 0,
    val artworkUri: String = "",
    val mimeType: String = "",
    val queuePosition: Int = 0,
    val favoriteRank: Int = 0,
    val technicalDetail: String = "",
    val fetchedAt: Long = System.currentTimeMillis(),
    val remote: Boolean = false,
)

@Dao
interface SourceDao {
    @Query("SELECT * FROM sources ORDER BY createdAt")
    fun observeAll(): Flow<List<SourceEntity>>

    @Query("SELECT * FROM sources WHERE enabled = 1 ORDER BY createdAt")
    fun getEnabledBlocking(): List<SourceEntity>

    @Query("SELECT * FROM sources WHERE id = :id LIMIT 1")
    suspend fun get(id: String): SourceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(source: SourceEntity)

    @Query("UPDATE sources SET refreshedAt = :at WHERE id = :id")
    suspend fun markRefreshed(id: String, at: Long)

    @Query("DELETE FROM sources WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
abstract class TrackDao {
    @Query("SELECT * FROM tracks WHERE role = 'MUSIC' ORDER BY queuePosition, title COLLATE NOCASE")
    abstract fun observeMusic(): Flow<List<TrackEntity>>

    @Query("SELECT * FROM tracks WHERE role = :role ORDER BY queuePosition, title COLLATE NOCASE")
    abstract fun getByRoleBlocking(role: MediaRole): List<TrackEntity>

    @Query("SELECT * FROM tracks WHERE mediaId = :mediaId LIMIT 1")
    abstract fun getBlocking(mediaId: String): TrackEntity?

    @Query("SELECT * FROM tracks WHERE sourceId = :sourceId ORDER BY queuePosition, title COLLATE NOCASE")
    abstract fun getForSourceBlocking(sourceId: String): List<TrackEntity>

    @Query("SELECT COUNT(*) FROM tracks WHERE favoriteRank > 0")
    abstract suspend fun favoriteCount(): Int

    @Query("SELECT MAX(favoriteRank) FROM tracks")
    abstract suspend fun maxFavoriteRank(): Int?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertAll(items: List<TrackEntity>)

    @Query("DELETE FROM tracks WHERE sourceId = :sourceId")
    abstract suspend fun deleteForSource(sourceId: String)

    @Query("DELETE FROM tracks WHERE mediaId = :mediaId")
    abstract suspend fun delete(mediaId: String)

    @Query("UPDATE tracks SET queuePosition = :position WHERE mediaId = :mediaId")
    abstract suspend fun setPosition(mediaId: String, position: Int)

    @Query("UPDATE tracks SET favoriteRank = :rank WHERE mediaId = :mediaId")
    abstract suspend fun setFavoriteRank(mediaId: String, rank: Int)

    @Query("UPDATE tracks SET favoriteRank = favoriteRank - 1 WHERE favoriteRank > :rank")
    abstract suspend fun closeFavoriteGap(rank: Int)

    @Transaction
    open suspend fun replaceSource(sourceId: String, items: List<TrackEntity>) {
        deleteForSource(sourceId)
        if (items.isNotEmpty()) upsertAll(items)
    }

    @Transaction
    open suspend fun toggleFavorite(track: TrackEntity): Boolean {
        if (track.favoriteRank > 0) {
            setFavoriteRank(track.mediaId, 0)
            closeFavoriteGap(track.favoriteRank)
            return false
        }
        if (favoriteCount() >= 3) return false
        setFavoriteRank(track.mediaId, (maxFavoriteRank() ?: 0) + 1)
        return true
    }
}

@Database(
    entities = [SourceEntity::class, TrackEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class RadioDatabase : RoomDatabase() {
    abstract fun sources(): SourceDao
    abstract fun tracks(): TrackDao

    companion object {
        @Volatile private var instance: RadioDatabase? = null

        fun get(context: Context): RadioDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    RadioDatabase::class.java,
                    "mirai-native-radio.db",
                ).build().also { instance = it }
            }
    }
}

package com.miraimelody.radio.data

internal fun <T> collectMediaRecursively(
    root: T,
    children: (T) -> List<T>,
    isDirectory: (T) -> Boolean,
    isPlayable: (T) -> Boolean,
    sortKey: (T) -> String,
): List<T> {
    val media = mutableListOf<T>()
    val pending = ArrayDeque<T>()

    children(root)
        .sortedBy(sortKey)
        .asReversed()
        .forEach(pending::addLast)

    while (pending.isNotEmpty()) {
        val item = pending.removeLast()
        if (isDirectory(item)) {
            children(item)
                .sortedBy(sortKey)
                .asReversed()
                .forEach(pending::addLast)
        } else if (isPlayable(item)) {
            media += item
        }
    }

    return media
}
package com.miraimelody.radio.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.miraimelody.radio.MainActivity
import org.junit.Rule
import org.junit.Test

class RadioAppTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun allNativeDestinationsAreReachableWithoutAWebsite() {
        compose.onNodeWithText("mirAI melody").assertIsDisplayed()
        compose.onNodeWithText("Sources").performClick()
        compose.onNodeWithText("YouTube playlist ID").assertIsDisplayed()
        compose.onNodeWithText("Queue").performClick()
        compose.onNodeWithText("Your local queue is empty").assertIsDisplayed()
        compose.onNodeWithText("Broadcast").performClick()
        compose.onNodeWithText("Broadcast Settings").assertIsDisplayed()
        compose.onNodeWithText("Connect").performClick()
        compose.onNodeWithText("Connection & Cache").assertIsDisplayed()
    }
}

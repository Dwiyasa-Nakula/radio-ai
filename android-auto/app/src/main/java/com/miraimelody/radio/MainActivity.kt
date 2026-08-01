package com.miraimelody.radio

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import com.miraimelody.radio.ui.RadioApp
import com.miraimelody.radio.ui.RadioViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: RadioViewModel by viewModels()
    private val notifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        setContent { RadioApp(viewModel) }
    }
}

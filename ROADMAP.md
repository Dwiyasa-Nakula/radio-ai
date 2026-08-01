# Roadmap and remaining work

This file separates release blockers and operational follow-ups from optional product ideas.
Items are ordered by recommended priority.

## Required follow-ups

- [ ] Create a private Android release-signing keystore outside the repository, configure the release build locally, and archive its recovery material securely.
- [ ] Build and install a signed `0.3.0` release APK; verify the certificate, R8 output, upgrade behavior, and local playback in airplane mode on a physical phone.
- [ ] Run the instrumented Compose and Keystore tests on an emulator/device and complete Android Auto Desktop Head Unit browsing, playback, reconnect, and distraction-compliance checks.
- [ ] Exercise connectivity loss during every show segment, stale weather/news fallback, cache eviction, next-cycle prefetch, and automatic reconnection on real hardware.
- [ ] Configure GitHub Workload Identity Federation with separate deployer and runtime identities, add the three documented repository secrets, test manual dispatch, and only then consider enabling deploy-on-push.
- [ ] If the web product will be deployed, set the exact Vercel origin in Cloud Run CORS, configure Vercel `BACKEND_URL` and the matching session secret, then verify the browser session exchange and range seeking.
- [ ] Add Google Cloud budget alerts, Cloud Run error/latency alerts, Secret Manager rotation reminders, and an Artifact Registry retention policy.
- [ ] Resolve Gradle deprecation warnings before upgrading to Gradle 10; keep Java 17+ and Android SDK discovery documented for clean machines.

## Recommended next features

1. **Device management and revocation** - Replace the environment hash list with a small authenticated enrollment registry that names devices, records last use, and revokes one device without rotating every phone.
2. **Show-plan persistence** - Persist the prefetched next cycle and segment state so playback can recover precisely after process death, reboot, or Android Auto disconnect.
3. **Observability dashboard** - Track segment-generation latency, provider fallback rate, cache hits, stream failures, and estimated provider cost without collecting local filenames or listening history.
4. **Android Auto voice actions** - Add safe voice commands for source selection, favorites, announcer language, and show mode using Media3 session commands.
5. **Scheduled programs** - Allow named presets and time-based schedules, such as a morning news show, commute traffic mode, or evening music-only block.
6. **Optional encrypted show packs** - Prefetch only generated speech and permitted remote metadata for a scheduled trip; continue to exclude YouTube and live-radio downloads.

## Longer-term ideas

- Multiple revocable household devices with per-device preferences.
- A backend provider-health page and automatic provider circuit breakers.
- Import/export of native source, queue, and broadcast settings without exporting credentials.
- Proper release channels with signed APK checksums and reproducible build documentation.
- Additional live-radio regions and localized weather/traffic providers behind the existing source interfaces.

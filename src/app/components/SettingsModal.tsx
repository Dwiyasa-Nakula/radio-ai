// src/app/components/SettingsModal.tsx
"use client";

import React, { useEffect, useState } from 'react';
import type { HostSettings, PlaybackSettings, SavedLocalPlaylist, SavedPlaylist } from '../lib/types';
import { extractPlaylistId } from '../lib/playlists';
import { loadLocalDirectory } from '../lib/localBrowseClient';
import LocalPlaylistEditor from './LocalPlaylistEditor';
import {
  pickAndStoreDirectory,
  registerSessionDirectoryFiles,
  scanBrowserPlaylist,
  supportsPersistentDirectoryPicker,
} from '../lib/browserLocalLibrary';
import { primeLocalLibrary } from '../lib/localLibraryClient';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  playlists: SavedPlaylist[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onAdd: (entry: SavedPlaylist) => void;
  onUpdate: (entry: SavedPlaylist) => void;
  onRemove: (id: string) => void;
  hostSettings: HostSettings;
  onHostSettingsChange: (settings: HostSettings) => void;
  playbackSettings: PlaybackSettings;
  onPlaybackSettingsChange: (settings: PlaybackSettings) => void;
}

type AddTab = 'youtube' | 'local';

type SettingsSection = 'broadcast' | 'playback' | 'sources' | 'queue';

const SETTINGS_TABS: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'broadcast', label: 'Broadcast', description: 'Voice, news, weather, traffic' },
  { id: 'playback', label: 'Playback', description: 'Streaming quality and data use' },
  { id: 'sources', label: 'Sources', description: 'Pick active station or playlist' },
  { id: 'queue', label: 'Local Queue', description: 'Choose songs and order' },
];

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  playlists,
  activeId,
  onActivate,
  onAdd,
  onUpdate,
  onRemove,
  hostSettings,
  onHostSettingsChange,
  playbackSettings,
  onPlaybackSettingsChange,
}) => {
  const [tab, setTab] = useState<AddTab>('youtube');
  const [name, setName] = useState('');
  const [urlOrId, setUrlOrId] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState(hostSettings);
  const [voiceSettingsDirty, setVoiceSettingsDirty] = useState(false);
  const [playbackDraft, setPlaybackDraft] = useState(playbackSettings);
  const [playbackDirty, setPlaybackDirty] = useState(false);
  const [addingLocal, setAddingLocal] = useState(false);

  const [showExplorer, setShowExplorer] = useState(false);
  const [explorerCurrentPath, setExplorerCurrentPath] = useState<string | null>(null);
  const [explorerSubdirs, setExplorerSubdirs] = useState<Array<{ name: string; path: string }>>([]);
  const [explorerParent, setExplorerParent] = useState<string | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>('broadcast');

  const loadExplorerPath = (pathString: string | null) => {
    setExplorerLoading(true);
    setError(null);
    loadLocalDirectory(pathString)
      .then((data) => {
        setExplorerCurrentPath(data.path);
        setExplorerSubdirs(data.subdirs || []);
        setExplorerParent(data.parent);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to list folders');
        console.warn('Settings modal error:', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setExplorerLoading(false);
      });
  };

  useEffect(() => {
    if (!open) return;
    setVoiceSettings(hostSettings);
    setVoiceSettingsDirty(false);
    setPlaybackDraft(playbackSettings);
    setPlaybackDirty(false);
    setShowExplorer(false);
    setExplorerCurrentPath(null);
    setExplorerSubdirs([]);
    setExplorerParent(null);
  }, [open, hostSettings, playbackSettings]);

  useEffect(() => {
    if (!editingLocalId) return;
    const stillExists = playlists.some(
      (playlist) => playlist.type === 'local' && playlist.id === editingLocalId
    );
    if (!stillExists) setEditingLocalId(null);
  }, [editingLocalId, playlists]);

  if (!open) return null;

  const localPlaylists = playlists.filter(
    (playlist): playlist is SavedLocalPlaylist => playlist.type === 'local'
  );
  const editingLocalPlaylist = localPlaylists.find((playlist) => playlist.id === editingLocalId) ?? null;

  const updateVoiceSettings = (patch: Partial<HostSettings>) => {
    setVoiceSettings((current) => ({ ...current, ...patch }));
    setVoiceSettingsDirty(true);
  };

  const handleAddYoutube = () => {
    setError(null);
    const playlistId = extractPlaylistId(urlOrId);
    if (!playlistId) {
      setError('Could not parse a playlist ID from that input.');
      return;
    }
    if (!name.trim()) {
      setError('Give the playlist a name.');
      return;
    }
    onAdd({
      id: `yt:${playlistId}:${Date.now()}`,
      name: name.trim(),
      type: 'youtube',
      playlistId,
    });
    setName('');
    setUrlOrId('');
  };

  const handleAddLocal = () => {
    setError(null);
    if (!folderPath.trim()) {
      setError('Enter a folder path.');
      return;
    }
    if (!name.trim()) {
      setError('Give the folder a name.');
      return;
    }
    onAdd({
      id: `local:${Date.now()}`,
      name: name.trim(),
      type: 'local',
      path: folderPath.trim(),
      localMode: 'server',
    });
    setName('');
    setFolderPath('');
  };

  const handleAddBrowserLocal = async () => {
    setError(null);
    setAddingLocal(true);
    const directoryId = `directory:${crypto.randomUUID()}`;
    try {
      const handle = await pickAndStoreDirectory(directoryId);
      const entry: SavedLocalPlaylist = {
        id: `local:${Date.now()}`,
        name: name.trim() || handle.name,
        type: 'local',
        localMode: 'browser',
        directoryHandleId: directoryId,
      };
      const tracks = await scanBrowserPlaylist(entry);
      primeLocalLibrary(entry, tracks);
      onAdd(entry);
      setName('');
    } catch (addError) {
      if (addError instanceof DOMException && addError.name === 'AbortError') return;
      setError(addError instanceof Error ? addError.message : 'Could not add browser folder');
    } finally {
      setAddingLocal(false);
    }
  };

  const handleSessionFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    setError(null);
    setAddingLocal(true);
    const directoryId = `session:${crypto.randomUUID()}`;
    try {
      const firstPath = files[0].webkitRelativePath || files[0].name;
      const entry: SavedLocalPlaylist = {
        id: `local:${Date.now()}`,
        name: name.trim() || firstPath.split('/')[0] || 'Local folder',
        type: 'local',
        localMode: 'input',
        directoryHandleId: directoryId,
      };
      const tracks = await registerSessionDirectoryFiles(directoryId, files);
      primeLocalLibrary(entry, tracks);
      onAdd(entry);
      setName('');
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not read selected files');
    } finally {
      setAddingLocal(false);
      event.target.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute inset-y-0 right-0 flex w-full justify-end sm:pl-10">
        <div
          className="settings-drawer radio-glass text-white h-full w-full max-w-4xl overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between py-2.5 pl-[15px] pr-5 border-b border-white/10">
              <div>
                <h2 className="text-xl font-semibold">Settings</h2>
                <p className="text-xs text-gray-400 mt-1">Broadcast controls, sources, and local queues are split into tabs.</p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <nav className="grid grid-cols-2 lg:grid-cols-4 gap-2 border-b border-white/10 px-2 py-1.5 bg-black/15">
              {SETTINGS_TABS.map((settingsTab) => (
                <button
                  key={settingsTab.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(settingsTab.id);
                    if (settingsTab.id === 'queue' && !editingLocalId && localPlaylists[0]) {
                      setEditingLocalId(localPlaylists[0].id);
                    }
                  }}
                  className={`rounded-2xl border px-3 py-1 text-left transition ${
                    activeSection === settingsTab.id
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50 shadow-lg shadow-cyan-500/10'
                      : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <span className="block text-sm font-semibold">{settingsTab.label}</span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">{settingsTab.description}</span>
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 space-y-6">
          {activeSection === 'broadcast' && (
          <section>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm uppercase tracking-wide text-gray-300">
                  AI voice & station breaks
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Spoken segments use Groq plus TTS. Jingles use your prerecorded audio files.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm shrink-0">
                <span>{voiceSettings.enabled ? 'On' : 'Off'}</span>
                <input
                  type="checkbox"
                  checked={voiceSettings.enabled}
                  onChange={(e) => updateVoiceSettings({ enabled: e.target.checked })}
                  className="w-5 h-5"
                />
              </label>
            </div>

            <div className={`space-y-3 ${voiceSettings.enabled ? '' : 'opacity-50'}`}>
              <div className={'rounded-xl border border-white/10 bg-black/15 p-4 space-y-3'}>
                <label className={'block'}>
                  <span className={'text-sm font-medium'}>Announcer language</span>
                  <select
                    value={voiceSettings.announcerLanguage}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) =>
                      updateVoiceSettings({ announcerLanguage: e.target.value === 'en' ? 'en' : 'ja' })
                    }
                    className={'mt-2 w-full bg-black/25 border border-white/10 rounded-lg px-3 py-2 text-sm'}
                  >
                    <option value={'ja'}>Japanese</option>
                    <option value={'en'}>English</option>
                  </select>
                </label>
                <label className={'flex items-center justify-between gap-3'}>
                  <span className={'text-sm'}>
                    Remember the show
                    <span className={'block text-xs text-gray-400'}>Context from the last 10 songs and recent announcements.</span>
                  </span>
                  <input
                    type={'checkbox'}
                    checked={voiceSettings.djMemoryEnabled}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) => updateVoiceSettings({ djMemoryEnabled: e.target.checked })}
                    className={'w-5 h-5'}
                  />
                </label>
                <label className={'flex items-center justify-between gap-3'}>
                  <span className={'text-sm'}>
                    Playful listener interaction
                    <span className={'block text-xs text-gray-400'}>Occasional fictional requests, themes, or vote prompts.</span>
                  </span>
                  <input
                    type={'checkbox'}
                    checked={voiceSettings.listenerInteractionEnabled}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) => updateVoiceSettings({ listenerInteractionEnabled: e.target.checked })}
                    className={'w-5 h-5'}
                  />
                </label>
              </div>
              <fieldset className="rounded-xl border border-white/10 bg-black/15 p-4">
                <legend className="px-1 text-sm font-medium">Show play order</legend>
                <div className="mt-1 grid gap-2">
                  {([
                    [
                      'fullShow',
                      'Full radio show',
                      'Intro jingle -> music -> outro jingle -> weather -> traffic -> news -> ad -> AnyVoice sponsor credit -> one combined previous/next song discussion.',
                    ],
                    [
                      'classic',
                      'Classic schedule',
                      'Keeps independent, selectable intervals for news, ads, traffic, jingles, and combined between-song discussion.',
                    ],
                  ] as const).map(([value, label, description]) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-xl border px-3 py-2 ${
                        voiceSettings.playOrder === value
                          ? 'border-purple-300/60 bg-purple-500/15'
                          : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="radio"
                          name="show-play-order"
                          value={value}
                          checked={voiceSettings.playOrder === value}
                          disabled={!voiceSettings.enabled}
                          onChange={() => updateVoiceSettings({ playOrder: value })}
                        />
                        {label}
                      </span>
                      <span className="mt-1 block pl-6 text-xs text-gray-400">{description}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  Full radio show runs every stage each cycle; unavailable prerecorded media or traffic audio is skipped automatically; or if you don&apos;t want a segment just turn it off below.
                </p>
              </fieldset>

              <div className="rounded-xl border border-white/10 bg-black/15 p-4">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="text-sm font-medium">🎙 Between-song host</span>
                    <span className="block text-xs text-gray-400">
                      Talks about the previous track and introduces the next one.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={voiceSettings.chatterEnabled}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) => updateVoiceSettings({ chatterEnabled: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
                <label className={`mt-3 flex items-center justify-between gap-3 ${voiceSettings.chatterEnabled ? '' : 'opacity-50'}`}>
                  <span className="text-sm">
                    Separate previous and next discussions
                    <span className="block text-xs text-gray-400">
                      Uses two AI/TTS calls in Full radio show. Off combines both songs into one lower-cost segment.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={voiceSettings.separateSongDiscussions}
                    disabled={!voiceSettings.enabled || !voiceSettings.chatterEnabled || voiceSettings.playOrder !== 'fullShow'}
                    onChange={(event) => updateVoiceSettings({ separateSongDiscussions: event.target.checked })}
                    className="h-5 w-5"
                  />
                </label>
                <label className={`block mt-3 ${voiceSettings.chatterEnabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>Speak every</span>
                    <span className="font-mono">{voiceSettings.frequency} songs</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={voiceSettings.frequency}
                    disabled={!voiceSettings.enabled || !voiceSettings.chatterEnabled}
                    onChange={(e) =>
                      updateVoiceSettings({ frequency: parseInt(e.target.value, 10) })
                    }
                    className="w-full"
                  />
                </label>
                <label className={`mt-3 flex items-center justify-between gap-3 ${voiceSettings.chatterEnabled ? '' : 'opacity-50'}`}>
                  <span className="text-sm">
                    Web-researched song trivia
                    <span className="block text-xs text-gray-400">
                      Sends only title, artist, album, and year to DuckDuckGo. Local files and paths never leave this device.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={voiceSettings.researchedChatter}
                    disabled={!voiceSettings.enabled || !voiceSettings.chatterEnabled}
                    onChange={(event) => updateVoiceSettings({ researchedChatter: event.target.checked })}
                    className="h-5 w-5"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">📰 News updates</span>
                  <span className="font-mono">
                    {voiceSettings.newsEvery === 0
                      ? 'scheduled only'
                      : `every ${voiceSettings.newsEvery} songs`}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  Set to 0 to use only the morning/noon schedule below.
                </p>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={voiceSettings.newsEvery}
                  disabled={!voiceSettings.enabled}
                  onChange={(e) =>
                    updateVoiceSettings({ newsEvery: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <label className="block mt-3">
                  <span className="text-sm">News focus</span>
                  <span className="block text-xs text-gray-400 mb-1">
                    Optional. The host prioritizes matching NHK World headlines without inventing facts.
                  </span>
                  <input
                    type="text"
                    maxLength={160}
                    value={voiceSettings.newsFocus}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) => updateVoiceSettings({ newsFocus: e.target.value })}
                    placeholder="e.g. Japan technology, anime industry, Southeast Asia"
                    className="w-full bg-black/25 border border-white/10 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/15 p-4 space-y-3">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="text-sm font-medium">📢 Sponsored ad break</span>
                    <span className="block text-xs text-gray-400">
                      Full radio show always plays one ad after News. This switch controls Classic schedule ads.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={voiceSettings.adsEnabled}
                    disabled={!voiceSettings.enabled}
                    onChange={(event) => updateVoiceSettings({ adsEnabled: event.target.checked })}
                    className="h-5 w-5"
                  />
                </label>

                  <p className="text-xs text-gray-300">
                    Put each sponsor message in <code>public/ads/</code> as an <code>.mp3</code> or <code>.mp4</code> file. MP3 Title and cover-art tags are read automatically; MP4 video is used as its artwork.
                  </p>
                  <p className="text-xs text-gray-400">
                    Put YouTube links in <code>public/ads/ads link.json</code>: <code>{'{ "links": ["https://youtu.be/VIDEO_ID"] }'}</code>. Local files and links share one shuffled rotation, and YouTube supplies the title and thumbnail.
                  </p>

                <div className={`space-y-3 ${voiceSettings.adsEnabled ? '' : 'opacity-50'}`}>
                  <label className="block">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span>Classic schedule frequency</span>
                      <span className="font-mono">every {voiceSettings.adEvery} songs</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={voiceSettings.adEvery}
                      disabled={!voiceSettings.enabled || !voiceSettings.adsEnabled}
                      onChange={(event) => updateVoiceSettings({ adEvery: parseInt(event.target.value, 10) })}
                      className="w-full"
                    />
                  </label>

                  <p className="text-xs text-gray-400">
                    Full radio show ignores this Classic-only switch and always places one break after News. The follow-up credit announces the selected ad title and always uses AnyVoice.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">🚆 Traffic updates</span>
                  <span className="font-mono">
                    {voiceSettings.trafficEvery === 0
                      ? 'off'
                      : `every ${voiceSettings.trafficEvery} songs`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={voiceSettings.trafficEvery}
                  disabled={!voiceSettings.enabled}
                  onChange={(e) =>
                    updateVoiceSettings({ trafficEvery: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Real-time traffic incidents from TomTom. Requires <code>TOMTOM_API_KEY</code>.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/15 p-4 space-y-3">
                <p className="text-sm font-medium">⏰ Scheduled briefings</p>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    Morning, 5–11 AM JST
                    <span className="block text-xs text-gray-400">News briefing and Tokyo weather.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={voiceSettings.morningPreroll}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) => updateVoiceSettings({ morningPreroll: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    Noon, 11 AM–2 PM JST
                    <span className="block text-xs text-gray-400">News briefing and Tokyo weather.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={voiceSettings.noonPreroll}
                    disabled={!voiceSettings.enabled}
                    onChange={(e) => updateVoiceSettings({ noonPreroll: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">🎵 Prerecorded jingle</span>
                  <span className="font-mono">
                    {voiceSettings.jingleEvery === 0
                      ? 'off'
                      : `every ${voiceSettings.jingleEvery} songs`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={voiceSettings.jingleEvery}
                  disabled={!voiceSettings.enabled}
                  onChange={(e) =>
                    updateVoiceSettings({ jingleEvery: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Uses independent shuffle bags in <code>public/Outro Jingle/</code> and <code>public/Intro jingles/</code>. Classic plays Outro before the break and Intro before the next song. MP4 video appears in the player artwork; jingles do not use TTS.
                </p>
              </div>
            </div>

            <label className={'mt-3 rounded-xl border border-white/10 bg-black/15 p-4 flex items-center justify-between gap-3'}>
              <span className={'text-sm'}>
                ReplayGain normalization
                <span className={'block text-xs text-gray-400'}>
                  Applies embedded loudness gain when a local track provides it.
                </span>
              </span>
              <input
                type={'checkbox'}
                checked={voiceSettings.audioNormalization}
                onChange={(e) => updateVoiceSettings({ audioNormalization: e.target.checked })}
                className={'w-5 h-5'}
              />
            </label>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 text-center sm:text-left">
              <p className="text-xs text-gray-400">
                Changes rebuild the radio queue only when applied.
              </p>
              <button
                type="button"
                disabled={!voiceSettingsDirty}
                onClick={() => {
                  onHostSettingsChange({
                    ...voiceSettings,
                    newsFocus: voiceSettings.newsFocus.trim(),
                  });
                  setVoiceSettingsDirty(false);
                }}
                className="bg-purple-500 hover:bg-purple-400 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm font-semibold py-2 px-4 rounded-lg w-full sm:w-auto"
              >
                Apply broadcast settings
              </button>
            </div>
          </section>
          )}

          {activeSection === 'playback' && (
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-300">Playback quality</h3>
            <p className="mt-1 text-xs text-gray-400">
              Local FLAC, WAV, and other files always play byte-for-byte. This setting changes only YouTube and live-radio source selection.
            </p>
            <div className="mt-4 grid gap-3">
              {([
                ['high', 'High', 'Bitrate: no fixed cap', 'YouTube selects the best browser-playable HTTPS audio stream. Radio ranks Opus, AAC+, AAC, OGG, then MP3 before preferring higher bitrate.'],
                ['balanced', 'Balanced', 'Bitrate: no fixed cap', 'YouTube prefers M4A/AAC audio for broad compatibility. Radio ranks by station popularity instead of codec or bitrate.'],
                ['dataSaver', 'Data Saver', 'Bitrate: target <= 96 kbps; fallback <= 128 kbps, then best available', 'Radio prefers streams at or below 96 kbps (or unknown bitrate), then the lowest known bitrate.'],
              ] as const).map(([value, label, bitrate, specification]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${
                    playbackDraft.audioQuality === value
                      ? 'border-blue-300/60 bg-blue-500/15'
                      : 'border-white/10 bg-black/15'
                  }`}
                >
                  <input
                    type="radio"
                    name="audio-quality"
                    value={value}
                    checked={playbackDraft.audioQuality === value}
                    onChange={() => {
                      setPlaybackDraft({ audioQuality: value });
                      setPlaybackDirty(true);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-1 block text-xs font-medium text-blue-200">{bitrate}</span>
                    <span className="mt-0.5 block text-xs text-gray-400">{specification}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={!playbackDirty}
                onClick={() => {
                  onPlaybackSettingsChange(playbackDraft);
                  setPlaybackDirty(false);
                }}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold hover:bg-blue-400 disabled:bg-gray-700 disabled:text-gray-400"
              >
                Apply playback settings
              </button>
            </div>
          </section>
          )}

          {activeSection === 'sources' && (
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Active source</h3>
            <ul className="space-y-2">
              {playlists.map((p) => (
                <li
                  key={p.id}
                  className={`flex flex-col rounded-md border px-3 py-2 gap-3 ${
                    activeId === p.id ? 'border-green-500 bg-green-500/10' : 'border-gray-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                    <button onClick={() => onActivate(p.id)} className="flex-grow text-left w-full sm:w-auto">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-gray-400 break-all">
                        {p.type === 'youtube'
                          ? `YouTube · ${p.playlistId}`
                          : p.type === 'radio'
                            ? 'Live stations · Japan, China, South Korea'
                            : p.localMode === 'browser'
                              ? 'Local / persistent browser folder'
                              : p.localMode === 'input'
                                ? 'Local / session-only browser folder'
                                : p.path
                              ? `Local · ${p.path}`
                              : 'Local · (LOCAL_MUSIC_DIR)'}
                      </div>
                      {p.type === 'local' && Array.isArray(p.includedTrackIds) && (
                        <div className="mt-1 text-[11px] text-cyan-300">
                          Custom queue · {p.includedTrackIds.length} songs
                        </div>
                      )}
                    </button>
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                      {p.type === 'local' && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLocalId(p.id);
                            setActiveSection('queue');
                          }}
                          className="rounded-lg bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 text-left sm:text-center"
                        >
                          {editingLocalId === p.id ? 'Editing queue' : 'Choose songs'}
                        </button>
                      )}
                      {p.type !== 'radio' && (
                        <button
                          onClick={() => onRemove(p.id)}
                          className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-300 hover:bg-red-500/20 hover:text-red-200 text-sm text-left sm:text-center"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

          </section>
          )}

          {activeSection === 'queue' && (
          <section>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Local song queue</h3>
                <p className="text-xs text-gray-400">
                  Build a persistent per-device queue from any saved local folder.
                </p>
              </div>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                {localPlaylists.length} local source{localPlaylists.length === 1 ? '' : 's'}
              </span>
            </div>

            {localPlaylists.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm text-gray-300">
                Add a local folder first, then come back here to choose included songs and queue order.
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium">Local playlist</span>
                  <select
                    value={editingLocalId ?? ''}
                    onChange={(event) => setEditingLocalId(event.target.value || null)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm"
                  >
                    <option value="">Select a local playlist...</option>
                    {localPlaylists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name}
                      </option>
                    ))}
                  </select>
                </label>

                {editingLocalPlaylist ? (
                  <LocalPlaylistEditor
                    key={editingLocalPlaylist.id}
                    playlist={editingLocalPlaylist}
                    onSave={onUpdate}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-black/10 p-6 text-center text-sm text-gray-400">
                    Select a local playlist to edit its included songs.
                  </div>
                )}
              </div>
            )}
          </section>
          )}

          {activeSection === 'sources' && (
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Add source</h3>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  setTab('youtube');
                  setError(null);
                }}
                className={`px-3 py-1 rounded text-sm ${
                  tab === 'youtube' ? 'bg-blue-500' : 'bg-gray-800 hover:bg-gray-700'
                }`}
              >
                YouTube playlist
              </button>
              <button
                onClick={() => {
                  setTab('local');
                  setError(null);
                }}
                className={`px-3 py-1 rounded text-sm ${
                  tab === 'local' ? 'bg-blue-500' : 'bg-gray-800 hover:bg-gray-700'
                }`}
              >
                Local folder
              </button>
            </div>

            {tab === 'youtube' ? (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Playlist URL or ID"
                  value={urlOrId}
                  onChange={(e) => setUrlOrId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                />
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button
                  onClick={handleAddYoutube}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded"
                >
                  Add playlist
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                />
                <div className="rounded-xl border border-cyan-300/20 bg-cyan-950/20 p-4">
                  <h4 className="text-sm font-semibold text-cyan-100">Browser folder access</h4>
                  <p className="mt-1 text-xs text-gray-400">
                    Recommended for Vercel. Scans every MP3 and supported audio file under the selected root, including all nested folders, and stores a read-only handle in this browser; no audio, paths, or artwork are uploaded.
                  </p>
                  {supportsPersistentDirectoryPicker() ? (
                    <button
                      type="button"
                      disabled={addingLocal}
                      onClick={() => void handleAddBrowserLocal()}
                      className="mt-3 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:bg-gray-700"
                    >
                      {addingLocal ? 'Scanning folder...' : 'Choose browser folder'}
                    </button>
                  ) : (
                    <label className="mt-3 inline-flex cursor-pointer rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
                      Choose folder for this session
                      <input
                        type="file"
                        multiple
                        accept="audio/*,.flac,.m4a,.opus,.webm"
                        onChange={(event) => void handleSessionFiles(event)}
                        className="sr-only"
                        {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                      />
                    </label>
                  )}
                  {!supportsPersistentDirectoryPicker() && (
                    <p className="mt-2 text-xs text-amber-300">
                      This browser cannot persist a directory handle. You must choose the folder again after every refresh.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wide text-gray-500">
                  <span className="h-px flex-1 bg-white/10" />
                  Local development / self-hosting
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Absolute folder path (e.g. D:\Music\Lo-fi)"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    className="flex-grow bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowExplorer(true);
                      loadExplorerPath(folderPath.trim() || null);
                    }}
                    className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold py-2 px-3 rounded shrink-0"
                  >
                    Browse
                  </button>
                </div>
                {showExplorer && (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 mt-2 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-300">
                      <span className="truncate max-w-full sm:max-w-[60%] font-mono bg-black/20 px-2 py-1 rounded">
                        Folder: {explorerCurrentPath || 'Drives'}
                      </span>
                      <div className="flex gap-2 shrink-0 justify-end">
                        {explorerParent !== undefined && (
                          <button
                            type="button"
                            onClick={() => loadExplorerPath(explorerParent)}
                            className="bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded text-[11px]"
                          >
                            Up ↱
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (explorerCurrentPath) {
                              setFolderPath(explorerCurrentPath);
                            }
                            setShowExplorer(false);
                          }}
                          className="bg-green-600 hover:bg-green-500 text-white px-2.5 py-1 rounded text-[11px]"
                          disabled={!explorerCurrentPath}
                        >
                          Select ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowExplorer(false)}
                          className="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white px-2.5 py-1 rounded text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    {explorerLoading ? (
                      <p className="text-xs text-gray-400 text-center py-4">Reading directories...</p>
                    ) : (
                      <ul className="max-h-[180px] overflow-y-auto divide-y divide-white/5 border border-white/5 rounded-lg bg-black/10 text-xs">
                        {explorerSubdirs.length === 0 ? (
                          <li className="p-3 text-center text-gray-500">No subdirectories found.</li>
                        ) : (
                          explorerSubdirs.map((dir) => (
                            <li key={dir.path}>
                              <button
                                type="button"
                                onClick={() => loadExplorerPath(dir.path)}
                                className="w-full text-left p-2.5 hover:bg-white/5 truncate font-mono flex items-center gap-1.5"
                              >
                                📁 {dir.name}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )}
                {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
                <button
                  onClick={handleAddLocal}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded"
                >
                  Add server path
                </button>
                <p className="text-xs text-gray-500">
                  Server paths work only when the Next.js process can read that machine. They are intentionally unavailable on Vercel.
                </p>
              </div>
            )}
          </section>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;

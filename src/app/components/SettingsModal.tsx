// src/app/components/SettingsModal.tsx
"use client";

import React, { useEffect, useState } from 'react';
import type { HostSettings, SavedPlaylist } from '../lib/types';
import { extractPlaylistId } from '../lib/playlists';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  playlists: SavedPlaylist[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onAdd: (entry: SavedPlaylist) => void;
  onRemove: (id: string) => void;
  hostSettings: HostSettings;
  onHostSettingsChange: (settings: HostSettings) => void;
}

type AddTab = 'youtube' | 'local';

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  playlists,
  activeId,
  onActivate,
  onAdd,
  onRemove,
  hostSettings,
  onHostSettingsChange,
}) => {
  const [tab, setTab] = useState<AddTab>('youtube');
  const [name, setName] = useState('');
  const [urlOrId, setUrlOrId] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState(hostSettings);
  const [voiceSettingsDirty, setVoiceSettingsDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVoiceSettings(hostSettings);
    setVoiceSettingsDirty(false);
  }, [open, hostSettings]);

  if (!open) return null;

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
    });
    setName('');
    setFolderPath('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="radio-glass text-white rounded-2xl shadow-xl max-w-xl w-full max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
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
                  max={10}
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
                    <span className="block text-xs text-gray-400">News and Tokyo weather.</span>
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
                    <span className="block text-xs text-gray-400">News briefing.</span>
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
                  Reads audio from <code>public/jingles/</code>; this does not use TTS.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-4">
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
                className="bg-purple-500 hover:bg-purple-400 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm font-semibold py-2 px-4 rounded-lg"
              >
                Apply voice settings
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Active source</h3>
            <ul className="space-y-2">
              {playlists.map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    activeId === p.id ? 'border-green-500 bg-green-500/10' : 'border-gray-700'
                  }`}
                >
                  <button onClick={() => onActivate(p.id)} className="flex-grow text-left">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-400 break-all">
                      {p.type === 'youtube'
                        ? `YouTube · ${p.playlistId}`
                        : p.type === 'radio'
                          ? 'Live stations · Japan, China, South Korea'
                          : p.path
                          ? `Local · ${p.path}`
                          : 'Local · (LOCAL_MUSIC_DIR)'}
                    </div>
                  </button>
                  {p.type !== 'radio' && (
                    <button
                      onClick={() => onRemove(p.id)}
                      className="ml-3 text-red-400 hover:text-red-300 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

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
                <input
                  type="text"
                  placeholder="Absolute folder path (e.g. D:\Music\Lo-fi)"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
                />
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button
                  onClick={handleAddLocal}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-2 px-4 rounded"
                >
                  Add folder
                </button>
                <p className="text-xs text-gray-500">
                  The folder is scanned recursively for audio files. Subfolders are included.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;

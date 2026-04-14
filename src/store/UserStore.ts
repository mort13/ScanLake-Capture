import { v4 as uuidv4 } from 'uuid'
import type { UserProfile, UserSettings } from '../types'

const PROFILE_KEY = 'scanlake_user_profile'
const SETTINGS_KEY = 'scanlake_user_settings'

function loadProfile(): UserProfile {
  const stored = localStorage.getItem(PROFILE_KEY)
  if (stored) {
    return JSON.parse(stored) as UserProfile
  }
  const profile: UserProfile = {
    userId: uuidv4(),
    userName: '',
    org: '',
    email: '',
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  return profile
}

function saveProfile(profile: UserProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

const DEFAULT_HOTKEYS = { capture: 'F9', save: 'F10', newCluster: 'F11' }

const DEFAULT_SHIP_PROFILE = 'mole_relative_anchors_crnn.json'

function loadSettings(): UserSettings {
  const stored = localStorage.getItem(SETTINGS_KEY)
  if (stored) {
    const parsed = JSON.parse(stored) as UserSettings
    // Backfill hotkeys for existing saves that predate this field
    if (!parsed.hotkeys) {
      parsed.hotkeys = { ...DEFAULT_HOTKEYS }
    }
    // Backfill selectedShipProfile for existing saves
    if (!parsed.selectedShipProfile) {
      parsed.selectedShipProfile = DEFAULT_SHIP_PROFILE
    }
    // Backfill captureResolution for existing saves
    if (parsed.captureResolution === undefined) {
      parsed.captureResolution = ''
    }
    // Backfill extensionHotkeys for existing saves
    if (parsed.extensionHotkeys === undefined) {
      parsed.extensionHotkeys = false
    }
    return parsed
  }
  return { autoArchive: false, autoDownload: false, hotkeys: { ...DEFAULT_HOTKEYS }, selectedShipProfile: DEFAULT_SHIP_PROFILE, captureResolution: '', extensionHotkeys: false }
}

function saveSettings(settings: UserSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export const UserStore = {
  loadProfile,
  saveProfile,
  loadSettings,
  saveSettings,
}

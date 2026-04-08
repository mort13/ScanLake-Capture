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

function loadSettings(): UserSettings {
  const stored = localStorage.getItem(SETTINGS_KEY)
  if (stored) {
    return JSON.parse(stored) as UserSettings
  }
  return { autoArchive: false, autoDownload: false }
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

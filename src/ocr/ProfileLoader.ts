import type { MasterProfile, ProfileConfig, AnchorConfig, SubAnchorConfig } from './types'

export const DEFAULT_PROFILE_FILE = 'mole_relative_anchors_crnn.json'

const profileCache = new Map<string, MasterProfile>()
const anchorImages = new Map<string, ImageData>()

export async function loadProfile(profileFile?: string): Promise<MasterProfile> {
  const file = profileFile ?? DEFAULT_PROFILE_FILE
  const cached = profileCache.get(file)
  if (cached) return cached
  const resp = await fetch(`/profiles/${file}`)
  if (!resp.ok) throw new Error(`Failed to load profile: ${resp.status}`)
  const profile = (await resp.json()) as MasterProfile
  profileCache.set(file, profile)
  return profile
}

export function getProfileConfig(profile: MasterProfile, name: string): ProfileConfig {
  const cfg = profile.profiles[name]
  if (!cfg) throw new Error(`Profile "${name}" not found`)
  // sub_anchors may be absent from updated profiles
  cfg.sub_anchors ??= []
  return cfg
}

export async function loadAnchorImage(templatePath: string): Promise<ImageData> {
  const cached = anchorImages.get(templatePath)
  if (cached) return cached

  const resp = await fetch(`/anchors/${templatePath}`)
  if (!resp.ok) throw new Error(`Failed to load anchor: ${templatePath}`)
  const blob = await resp.blob()
  const bitmap = await createImageBitmap(blob)

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()

  anchorImages.set(templatePath, imageData)
  return imageData
}

export async function loadAllAnchors(
  anchors: AnchorConfig[],
  subAnchors: SubAnchorConfig[],
): Promise<Map<string, ImageData>> {
  const paths = new Set<string>()
  for (const a of anchors) paths.add(a.template_path)
  for (const s of subAnchors) paths.add(s.template_path)

  await Promise.all([...paths].map(p => loadAnchorImage(p)))
  return anchorImages
}

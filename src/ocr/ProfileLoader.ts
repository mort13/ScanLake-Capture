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

/**
 * Scale all anchor images by a given factor.
 * Returns a NEW map — the original anchorImages cache is unchanged.
 * Scale factor 1.0 returns the same map reference (no copy).
 */
export async function scaleAnchorImages(
  images: Map<string, ImageData>,
  scale: number,
): Promise<Map<string, ImageData>> {
  if (scale === 1.0) return images
  const result = new Map<string, ImageData>()
  for (const [path, img] of images) {
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const src = new OffscreenCanvas(img.width, img.height)
    const srcCtx = src.getContext('2d')!
    srcCtx.putImageData(img, 0, 0)
    const dst = new OffscreenCanvas(w, h)
    const dstCtx = dst.getContext('2d')!
    dstCtx.drawImage(src, 0, 0, w, h)
    result.set(path, dstCtx.getImageData(0, 0, w, h))
  }
  return result
}

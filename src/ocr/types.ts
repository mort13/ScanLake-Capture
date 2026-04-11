/** Mirrors the JSON profile structure from Rock Capture CNN */

export interface RoiFilters {
  brightness: number
  contrast: number
  threshold: number
  threshold_enabled: boolean
  grayscale: boolean
  invert: boolean
  channel: 'none' | 'red' | 'green' | 'blue'
}

export interface RoiConfig {
  name: string
  x_offset: number
  y_offset: number
  width: number
  height: number
  filters: RoiFilters
  seg_mode: 'fixed_width' | 'projection' | 'contour'
  char_width: number
  char_count: number
  allowed_chars: string
  format_pattern: string
  dot_width: number
  enabled: boolean
  recognition_mode: 'cnn' | 'word_cnn' | 'template'
  template_dir: string
  csv_index: number
  ref_x: number
  ref_y: number
  sub_anchor?: string
}

export interface SearchRegion {
  x: number
  y: number
  w?: number
  h?: number
  width?: number
  height?: number
}

export interface AnchorConfig {
  name: string
  template_path: string
  match_threshold: number
  ref_x: number
  ref_y: number
  search_region?: SearchRegion
}

export interface SubAnchorConfig extends AnchorConfig {}

export interface ProfileConfig {
  name: string
  rois: RoiConfig[]
  search_region: SearchRegion
  monitor_index: number
  anchors: AnchorConfig[]
  sub_anchors: SubAnchorConfig[]
}

export interface OutputSchemaNode {
  key: string
  type?: 'object' | 'array' | 'ref'
  profile?: string
  roi?: string
  children?: OutputSchemaNode[]
}

export interface MasterProfile {
  name: string
  profiles: Record<string, ProfileConfig>
  output_schema: OutputSchemaNode[]
}

export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface RoiResult {
  roiName: string
  text: string
  confidence: number
}

export interface AnchorMatch {
  name: string
  /** TOP-LEFT X in image coordinates (OpenCV convention, matches spec) */
  x: number
  /** TOP-LEFT Y in image coordinates */
  y: number
  /** Template width — used by visualizers to compute center */
  w: number
  /** Template height */
  h: number
  confidence: number
}

export interface OcrPipelineResult {
  success: boolean
  roiResults: Map<string, RoiResult>
  error?: string
}

export type OcrStatus = 'idle' | 'capturing' | 'processing' | 'success' | 'error'

export interface ModelMeta {
  charClasses: string
  numClasses: number
  inputShape: number[]
  valAccuracy: number
  /** Word-class label list for word_cnn — populated by re-export or runtime detection */
  wordClasses?: string[]
}

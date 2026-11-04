/* =============================================================================
 * 辅助朗读：浏览器 speechSynthesis（中文）。默认关闭，与音效开关相互独立。
 * 页面同时用 aria-live 区域支持系统读屏；辅助朗读只是「再念一遍」的增强。
 * ========================================================================== */

let enabled = false

export function setNarrationEnabled(next: boolean): void {
  enabled = next
  if (!next) cancelSpeech()
}

export function isNarrationEnabled(): boolean {
  return enabled
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function cancelSpeech(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // 忽略：朗读不可用时静默
  }
}

/** 朗读一段中文文本；关闭或不可用时什么都不做 */
export function speak(text: string): void {
  if (!enabled || !text) return
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    synth.speak(utterance)
  } catch {
    // 忽略：朗读失败不影响主流程
  }
}

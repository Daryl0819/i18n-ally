import { ExtractionRule, ExtractionScore } from './base'

export class BasicExtrationRule extends ExtractionRule {
  name = 'basic'

  shouldExtract(str: string, attrName?: string) {
    const s = str.replace(/\$\{.*?\}/g, '').trim()

    if (s.length === 0)
      return ExtractionScore.MustExclude
    // const hasI18nCallee = s.match(/(?:^|[$.\b])t\w?\(/u)
    if (attrName?.includes('v-bk-tooltips') && s.includes('$t('))
      return ExtractionScore.MustExclude
    // ❌ brackets
    if (s.match(/^{.*}/) && s.match(/(?:^|[$.\b])t\w?\(/u))
      return ExtractionScore.MustExclude

    // ✅ 检测中文（汉字+中文标点）
    const hasChinese = /[\u4E00-\u9FA5]/.test(s) // 汉字
    const hasChinesePunctuation = /[\u3000-\u303F\uFF00-\uFFEF]/.test(s) // 中文标点符号
    // ✅ 包含中文汉字 → 必须处理
    if (hasChinese)
      return ExtractionScore.MustInclude
    // ❌ 排除纯中文符号（无汉字，只有中文标点）
    if (hasChinesePunctuation && !hasChinese)
      return ExtractionScore.MustExclude

    // // ✅ has a space, and any meaning full letters
    // if (s.includes(' ') && s.match(/\w/))
    //   return ExtractionScore.ShouldInclude
    // ❌ camel case
    if (s.match(/[a-z][A-Z0-9]/))
      return ExtractionScore.ShouldExclude
    // ❌ all lower cases
    if (s.match(/^[a-z0-9-]+$/))
      return ExtractionScore.ShouldExclude
    // ❌ all upper cases
    if (s.match(/^[A-Z0-9-]+$/))
      return ExtractionScore.ShouldExclude
    // ❌ all digits
    if (s.match(/^[\d.]+$/))
      return ExtractionScore.ShouldExclude
    // // ✅ all words
    // if (s.match(/^[A-Za-z0-9]+$/))
    //   return ExtractionScore.ShouldInclude
    // ✅ one char
    // if (s.length === 1 && !'/.-\\:+$^#_"\','.includes(s))
    //   return ExtractionScore.ShouldInclude
  }
}

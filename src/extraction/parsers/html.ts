import { Parser } from 'htmlparser2'
import { DefaultDynamicExtractionsRules, DefaultExtractionRules, ExtractionRule } from '../rules'
import { shouldExtract } from '../shouldExtract'
import { ExtractionHTMLOptions } from './options'
import { shiftDetectionPosition } from './utils'
import { DetectionResult } from '~/core/types'

const defaultOptions: Required<ExtractionHTMLOptions> = {
  attributes: ['title', 'alt', 'placeholder', 'label', 'aria-label'],
  ignoredTags: ['script', 'style'],
  vBind: true,
  inlineText: true,
}

export function detect(
  input: string,
  rules: ExtractionRule[] = DefaultExtractionRules,
  dynamicRules: ExtractionRule[] = DefaultDynamicExtractionsRules,
  userOptions: ExtractionHTMLOptions = {},
  extractScripts?: (script: string, start: number) => DetectionResult[],
): DetectionResult[] {
  const {
    attributes: ATTRS,
    ignoredTags: IGNORED_TAGS,
    vBind: V_BIND,
  } = Object.assign({}, defaultOptions, userOptions)

  const detections: DetectionResult[] = []

  // replace svelte inline function, #624
  input = input.replace(/<(.*?)={(.*?)}(.*?)>/g, '<$1="$2"$3>')
  const safeInput = input
    .replace(/<=/g, '__lte__') // 将 <= 替换为临时标记
    .replace(/>=/g, '__gte__') // 将 >= 替换为临时标记

  let lastTag = ''
  let lastScriptIndex: number | null = null
  const parser = new Parser({
    onopentag(name, attrs) {
      lastTag = name
      if (name === 'script')
        lastScriptIndex = parser.endIndex! + 1

      if (IGNORED_TAGS.includes(name))
        return

      const attrNames = Object.keys(attrs).map((name) => {
        // static
        if (ATTRS.includes(name) && shouldExtract(attrs[name], rules, name))
          return [name, false]
        // dynamic
        else if (
          V_BIND
          && ATTRS.some(n => name === `:${n}` || name === `v-bind:${n}`)
          && shouldExtract(attrs[name], dynamicRules)
        )
          return [name, true]
        return null
      })
        .filter(Boolean) as [string, boolean][]
      if (!attrNames.length)
        return

      const tagStart = parser.startIndex
      const tagEnd = parser.endIndex!
      const code = safeInput.slice(tagStart, tagEnd).replace(/__lte__/g, '<=').replace(/__gte__/g, '>=')

      for (const [name, isDynamic] of attrNames) {
        const match = code.match(
          new RegExp(`\\s${name}=(["'])([^\\1]*?)\\1`, 'm'),
        )
        if (!match)
          continue

        let fullStart = tagStart + match.index! + 1
        let fullEnd = fullStart + match[0].length - 1
        let fullText = safeInput.slice(fullStart, fullEnd).replace(/__lte__/g, '<=').replace(/__gte__/g, '>=')
        let start = fullStart + name.length + 2 // ="
        let end = fullEnd - 1 // "
        let text = safeInput.slice(start, end).replace(/__lte__/g, '<=').replace(/__gte__/g, '>=')

        if (name.includes('v-bk-tooltips') && /[\u4E00-\u9FA5]/.test(text)) {
          if (text.startsWith('{') && text.endsWith('}')) {
            try {
              // // 1. 替换单引号 `'` 为双引号 `"`
              // const jsonStr = text.replace(/'/g, '"')
              // // 2. 给键名 `content` 添加双引号（如果键名无引号）
              // const validJsonStr = jsonStr.replace(/(\w+):/g, '"$1":')
              // JSON.parse(validJsonStr)
              const newMatch = text.match(/content:\s*'([^']+)'/)
              // const newMatch = text.match(/[\u4E00-\u9FA5]+/m)
              if (!newMatch)
                throw new Error('No Chinese characters found')
              const index = newMatch[0].replace(newMatch[1], '').length - 1 + newMatch.index!
              fullStart = start + index - 1
              fullEnd = end - (text.length - text.slice(0, index + newMatch[1].length).length) + 1
              start = fullStart
              end = fullEnd
              fullText = newMatch[1]
              text = fullText
            }
            catch (_) {}
          }
          else {
            const splitTexts = text.split(/'([^']+)'/)
            if (splitTexts.length > 1 && splitTexts.find(txt => /[\u4E00-\u9FA5]/.test(txt))) {
              let calcStart = start

              for (let i = 0; i < splitTexts.length; i++) {
                const txt = splitTexts[i]
                const txtLen = txt.length
                if (!/[\u4E00-\u9FA5]/.test(txt)) {
                  calcStart += txtLen
                  continue
                }
                const remainingTxt = splitTexts.slice(i + 1).join('\'')
                const childEnd = end - remainingTxt.length
                const childStart = calcStart
                calcStart += txtLen + 2

                detections.push({
                  text: txt,
                  start: childStart,
                  end: childEnd,
                  isDynamic: false,
                  fullStart: childStart,
                  fullEnd: childEnd,
                  fullText: txt,
                  source: 'html-attribute',
                })
              }
              continue
            }
          }
        }

        detections.push({
          text,
          start,
          end,
          isDynamic,
          fullStart,
          fullEnd,
          fullText,
          source: 'html-attribute',
        })
      }
    },
    onclosetag(name) {
      if (name !== 'script' || lastScriptIndex == null)
        return
      const start = lastScriptIndex
      const fullText = safeInput.slice(start, parser.startIndex!).replace(/__lte__/g, '<=').replace(/__gte__/g, '>=')
      if (extractScripts)
        detections.push(...shiftDetectionPosition(extractScripts(fullText, start), start))
      lastScriptIndex = null
    },
    ontext(fullText) {
      if (lastScriptIndex != null)
        return
      if (IGNORED_TAGS.includes(lastTag))
        return

      const start = parser.startIndex
      const end = parser.endIndex! + 1

      const text = fullText.split(/\n/g).map(i => i.trim()).filter(Boolean).join(' ')

      if (!shouldExtract(text, rules))
        return
      if (text.startsWith('{{') && text.endsWith('}}') && /[\u4E00-\u9FA5]/.test(text)) {
        const offsetStartNum = fullText.indexOf('{{')
        const offsetEndIndex = fullText.indexOf('}}')
        const offsetEndNum = fullText.slice(offsetEndIndex + 2).length
        const actualStart = start + offsetStartNum
        const actualEnd = end - offsetEndNum
        const splitTexts = text.split(/'([^']+)'/)
        if (splitTexts.length > 1 && splitTexts.find(txt => /[\u4E00-\u9FA5]/.test(txt))) {
          let calcStart = actualStart
          let textStart = 0

          for (let i = 0; i < splitTexts.length; i++) {
            const txt = splitTexts[i]
            const txtLen = txt.length
            const remainingTxtWithSelf = text.slice(textStart)
            const widthQuotesNum = remainingTxtWithSelf.includes(`'${txt}'`) ? 2 : 0
            if (!/[\u4E00-\u9FA5]/.test(txt)) {
              calcStart += txtLen + widthQuotesNum
              textStart += txtLen + widthQuotesNum
              continue
            }
            const remainingTxt = splitTexts.slice(i + 1).join('\'')
            const childEnd = actualEnd - remainingTxt.length
            const childStart = calcStart
            calcStart += txtLen + widthQuotesNum
            textStart += txtLen + widthQuotesNum

            detections.push({
              text: txt,
              start: childStart,
              end: childEnd,
              fullText: txt,
              source: 'html-inline-custom',
            })
          }
          return
        }
      }

      detections.push({
        text: fullText,
        fullText,
        start,
        end,
        source: 'html-inline',
      })
    },
  }, {
    xmlMode: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  })

  parser.parseComplete(safeInput)

  return detections
}

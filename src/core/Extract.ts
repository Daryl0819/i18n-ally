import { basename, extname } from 'path'
import { TextDocument, window } from 'vscode'
import { nanoid } from 'nanoid'
import limax from 'limax'
import { Config, Global } from '../extension'
import { ExtractInfo } from './types'
import { CurrentFile } from './CurrentFile'
import { changeCase } from '~/utils/changeCase'

export function generateKeyFromText(text: string, filepath?: string, reuseExisting = false, usedKeys: string[] = []): string {
  let key: string | undefined

  // already existed, reuse the key
  // mostly for auto extraction
  if (reuseExisting) {
    key = Global.loader.searchKeyForTranslations(text)
    if (key)
      return key
  }

  // keygent
  const keygenStrategy = Config.keygenStrategy
  if (keygenStrategy === 'random') {
    key = nanoid()
  }
  else if (keygenStrategy === 'empty') {
    key = ''
  }
  else {
    if (Config.preferredDelimiter) {
      text = text
        .replace(/\$|\s/g, '')
        // 过滤所有特殊字符
        .replace(/^[^A-Za-z0-9\p{Unified_Ideograph}]+|[^A-Za-z0-9\p{Unified_Ideograph}]+$/giu, '')
        // 将文案中的特殊字符转化成下划线
        .replace(/[^A-Za-z0-9\p{Unified_Ideograph}]+/giu, Config.preferredDelimiter)
    }
    key = text
  }

  const keyPrefix = Config.keyPrefix
  if (keyPrefix && keygenStrategy !== 'empty')
    key = keyPrefix + key

  if (filepath && key.includes('fileName')) {
    key = key
      .replace('{fileName}', basename(filepath))
      .replace('{fileNameWithoutExt}', basename(filepath, extname(filepath)))
  }

  key = changeCase(key, Config.keygenStyle).trim()

  // some symbol can't convert to alphabet correctly, apply a default key to it
  if (!key)
    key = 'key'

  // suffix with a auto increment number if same key
  if (usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key)) {
    const originalKey = key
    let num = 0

    do {
      key = `${originalKey}${Config.preferredDelimiter}${num}`
      num += 1
    } while (
      usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key, false)
    )
  }

  return key
}

export async function extractHardStrings(document: TextDocument, extracts: ExtractInfo[], saveFile = false) {
  if (!extracts.length)
    return

  const editor = await window.showTextDocument(document)
  const filepath = document.uri.fsPath
  const sourceLanguage = Config.sourceLanguage

  extracts.sort((a, b) => b.range.start.compareTo(a.range.start))

  const isReplaced: ExtractInfo[] = []
  // replace
  await editor.edit((editBuilder) => {
    for (const extract of extracts) {
      const hasReplaced = isReplaced.find(item => (
        item.message === extract.message
        && (extract.range.contains(item.range) || item.range.contains(extract.range))
      ))

      if (hasReplaced)
        continue

      editBuilder.replace(
        extract.range,
        extract.replaceTo,
      )

      isReplaced.push(extract)
    }
  })

  // save keys
  await CurrentFile.loader.write(
    extracts
      .filter(i => i.keypath != null && i.message != null)
      .map(e => ({
        textFromPath: filepath,
        filepath: undefined,
        keypath: e.keypath!,
        value: e.message!,
        locale: e.locale || sourceLanguage,
        namespace: e.namespace,
      })),
  )

  if (saveFile)
    await document.save()

  CurrentFile.invalidate()
}

// static attrs to dynamic attrs
export async function staticAttrsToDynamic(document: TextDocument, extracts: ExtractInfo[]) {
  if (!extracts.length)
    return

  const editor = await window.showTextDocument(document)

  extracts.sort((a, b) => b.range.start.compareTo(a.range.start))

  const isReplaced: ExtractInfo[] = []
  // replace
  await editor.edit((editBuilder) => {
    for (const extract of extracts) {
      const hasReplaced = isReplaced.find(item => (
        item.message === extract.message
        && (extract.range.contains(item.range) || item.range.contains(extract.range))
      ))

      if (hasReplaced)
        continue

      editBuilder.replace(
        extract.range,
        extract.replaceTo,
      )
      isReplaced.push(extract)
    }
  })

  await document.save()

  CurrentFile.invalidate()
}

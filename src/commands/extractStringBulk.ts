import { commands, TextDocument, Uri, window, workspace, Range } from 'vscode'
import { notNullish } from '@antfu/utils'
import fs from 'fs-extra'
import { DetectHardStrings } from './detectHardStrings'
import { ExtensionModule } from '~/modules'
import { Commands } from '~/commands'
import { extractHardStrings, generateKeyFromText, staticAttrsToDynamic } from '~/core/Extract'
import { Config, Global, CurrentFile } from '~/core'
import { parseHardString } from '~/extraction/parseHardString'
import { DetectionResultToExtraction } from '~/editor/extract'
import { Log } from '~/utils'
import { gitignoredGlob } from '~/utils/glob'
import { ActionSource, Telemetry, TelemetryKey } from '~/core/Telemetry'

export async function BatchHardStringExtraction(...args: any[]) {
  const documents: (TextDocument | undefined)[] = []
  let actionSource: ActionSource

  // call from file explorer context
  if (args.length >= 2 && Array.isArray(args[1])) {
    actionSource = ActionSource.ContextMenu
    const map = new Map<string, Uri>()

    for (const uri of args[1]) {
      // folder, scan glob
      if (fs.lstatSync(uri.fsPath).isDirectory()) {
        const files = await gitignoredGlob('**/*.*', uri.fsPath)

        files.forEach((f) => {
          if (!map.has(f))
            map.set(f, Uri.file(f))
        })
      }
      // file, append to the map
      else {
        map.set(uri.fsPath, uri)
      }
    }

    const files = [...map.values()]

    documents.push(
      ...await Promise.all(files.map(i => workspace.openTextDocument(i))),
    )
  }
  // call from command pattale
  else {
    actionSource = ActionSource.CommandPattele
    documents.push(window.activeTextEditor?.document)
  }

  Telemetry.track(TelemetryKey.ExtractStringBulk, { source: actionSource, files: documents.length })

  Log.info('📤 Bulk extracting')
  Log.info(documents.map(i => `  ${i?.uri.fsPath}`).join('\n'))

  for (const document of documents) {
    if (!document)
      continue

    try {
      const result = await DetectHardStrings(document, false)
      Log.info(`📤 Extracting [${result?.length || 0}] ${document.uri.fsPath}`)
      if (!result)
        continue

      const usedKeys: string[] = []

      await extractHardStrings(
        document,
        result.map((i) => {
          const options = DetectionResultToExtraction(i, document)

          if (options.rawText && !options.text) {
            const result = parseHardString(options.rawText, options.document.languageId, options.isDynamic)
            options.text = result?.text || ''
            options.args = result?.args
          }

          const { rawText, text, range, args } = options
          const filepath = document.uri.fsPath
          const keypath = generateKeyFromText(rawText || text, filepath, true, usedKeys)
          const templates = Global.interpretRefactorTemplates(keypath, args, document, i).filter(Boolean)

          if (!templates.length) {
            Log.warn(`No refactor template found for "${keypath}" in "${filepath}"`)
            return undefined
          }

          usedKeys.push(keypath)

          let namespace: string | undefined = Config.namespace ? Config.defaultNamespace : undefined
          let rewriteText = text
          if (Config.namespace) {
            const files = CurrentFile.loader.files
            for (const file of files) {
              if (file.namespace && text.startsWith(file.namespace)) {
                namespace = file.namespace
                rewriteText = text.slice(namespace.length + 1)
              }
            }
          }

          return {
            range,
            replaceTo: templates[0],
            keypath,
            message: rewriteText,
            locale: Config.displayLanguage,
            namespace,
          }
        })
          .filter(notNullish),
        true,
      )

      // replace attrs
      const resultForAttrs = await DetectHardStrings(document, false)
      if (resultForAttrs) {
        await staticAttrsToDynamic(
          document,
          resultForAttrs
            .filter(i => i.source === 'html-attribute' && !i.isDynamic && i.fullStart !== undefined && i.fullText)
            .map((detection) => {
              const start = detection.fullStart!
              const end = detection.start - 2

              const text = detection.fullText!.split('=')[0]
              const options = {
                isDynamic: detection.isDynamic,
                document,
                text: '',
                rawText: text.trim(),
                isInsert: false,
                range: new Range(
                  document.positionAt(start),
                  document.positionAt(end),
                ),
              }

              return {
                range: options.range,
                replaceTo: `:${text}`,
                keypath: '',
                message: text,
                locale: Config.displayLanguage,
              }
            })
            .filter(notNullish),
        )
      }
    }
    catch (e) {
      Log.error(`Failed to extract ${document.fileName}`)
      Log.error(e, false)
    }
  }
}

const m: ExtensionModule = () => {
  return [
    commands.registerCommand(Commands.extract_hard_strings_batch, BatchHardStringExtraction),
  ]
}

export default m

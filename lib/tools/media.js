/**
 * Image tool: fetch a page's source / clean / translated image and save it to disk.
 *
 * @module dsh-plugin-saber/tools/media
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTextTool } from './shared.js'

const KIND_FIELD = { source: 'sourceUrl', clean: 'cleanUrl', translated: 'translatedUrl' }
const KIND_LABEL = { source: '原图', clean: '去字图', translated: '译图' }
const EXT_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

function imageDir() {
  const dir = join(tmpdir(), 'dsh-saber-images')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function mediaTools(deps) {
  const { getAdapter, client } = deps

  return [
    defineTextTool({
      name: 'saber_page_image',
      description:
        '取某一页的图片（只读）。kind=source 原图、clean 去字图、translated 译图（默认）。'
        + '图片会落到本机临时目录并返回路径，可直接打开；同时返回 Saber 的访问 URL。',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: '页面 ID（来自 saber_pages）' },
          kind: {
            type: 'string',
            enum: ['source', 'clean', 'translated'],
            description: '取哪种图，默认 translated',
          },
        },
        required: ['pageId'],
        additionalProperties: false,
      },
      async run(args) {
        const pageId = String(args.pageId ?? '').trim()
        if (pageId.length === 0) throw new Error('pageId 不能为空：先用 saber_pages 找页面。')
        const kind = typeof args.kind === 'string' ? args.kind : 'translated'
        const adapter = await getAdapter()
        if (!adapter) throw new Error('Saber 未运行：先用 saber_backend action=status 排查。')
        if (adapter.flavor !== 'v2') throw new Error('saber_page_image 需要 Saber 3.5+（/api/v2）。')

        const page = await adapter.getPage(pageId)
        const field = KIND_FIELD[kind] ?? KIND_FIELD.translated
        const relativeUrl = page?.[field]
        if (!relativeUrl) {
          const hint = kind === 'translated'
            ? '这一页还没有译图：先用 saber_translate 排翻译，等 saber_job 完成后再取。'
            : `这一页没有${KIND_LABEL[kind]}。`
          return `页面 ${pageId}（第${page?.ordinal ?? '?'}页）：${hint}`
        }

        const { buffer, contentType } = await adapter.fetchImage(relativeUrl)
        const ext = EXT_BY_TYPE[contentType] ?? 'bin'
        const file = join(imageDir(), `${pageId}-${kind}.${ext}`)
        writeFileSync(file, buffer)
        const absoluteUrl = client.absolute(relativeUrl)
        return [
          `页面 ${pageId}（第${page?.ordinal ?? '?'}页）${KIND_LABEL[kind]}`,
          `本地文件：${file}`,
          `Saber URL：${absoluteUrl}`,
          `大小：${(buffer.length / 1024).toFixed(1)} KB · 类型：${contentType}`,
        ].join('\n')
      },
    }),
  ]
}

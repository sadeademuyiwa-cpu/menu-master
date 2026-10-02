'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { safeImageUrl } from '@/lib/site/settings'

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_BYTES = 2 * 1024 * 1024

/** What went wrong with an upload, in words. Storage's own text never reaches the page. */
function uploadProblem(err: { message?: string; statusCode?: string | number; status?: number } | null): string {
  const code = String(err?.statusCode ?? err?.status ?? '')
  const msg = (err?.message ?? '').toLowerCase()
  if (code === '413' || msg.includes('exceeded') || msg.includes('too large')) return 'That picture is larger than 2 MB. Make it smaller and try again.'
  if (code === '415' || msg.includes('mime')) return 'Use a PNG, JPEG or WebP picture.'
  if (code === '404' || msg.includes('bucket not found')) return 'Picture uploads are not set up on this database yet (0059). Paste a link instead.'
  if (code === '403' || msg.includes('row-level security') || msg.includes('unauthorized')) return 'Only a platform admin can upload pictures.'
  return 'The upload did not finish. Check your connection and try again.'
}

/**
 * A picture on the public website: a link, or a file uploaded from this
 * phone or computer into the public "site" bucket (0059). The upload only
 * fills in the link -- nothing changes on the website until the form's Save
 * is pressed, like every other field here.
 */
export function ImageField({ name, label, defaultValue = '', placeholder, prefix, help }: {
  name: string
  label?: string
  defaultValue?: string
  placeholder?: string
  /** Start of the uploaded file's name, e.g. "logo". */
  prefix: string
  help?: string
}) {
  const [value, setValue] = useState(defaultValue)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const preview = safeImageUrl(value)

  async function upload(file: File) {
    setNote(null)
    const ext = TYPES[file.type]
    if (!ext) return setNote({ text: 'Use a PNG, JPEG or WebP picture.', bad: true })
    if (file.size > MAX_BYTES) {
      return setNote({ text: `That picture is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB. Make it smaller and try again.`, bad: true })
    }
    setBusy(true)
    const supabase = createClient()
    const path = `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`
    const { error } = await supabase.storage.from('site').upload(path, await file.arrayBuffer(), {
      contentType: file.type, cacheControl: '31536000', upsert: false,
    })
    setBusy(false)
    if (error) return setNote({ text: uploadProblem(error as never), bad: true })
    setValue(supabase.storage.from('site').getPublicUrl(path).data.publicUrl)
    setNote({ text: 'Uploaded. Press Save below to put it on the website.', bad: false })
  }

  const field = (
    <input
      name={name} value={value} onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder} aria-label={label ? undefined : placeholder}
      className="mm-input mt-1" autoComplete="off" spellCheck={false}
    />
  )

  return (
    <div className="block">
      {label ? (
        <label className="block">
          <span className="text-sm font-medium">{label}</span>
          {field}
        </label>
      ) : field}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="mm-btn mm-btn-secondary" disabled={busy} aria-busy={busy || undefined}
                onClick={() => picker.current?.click()}>
          {busy && <span className="mm-spinner" aria-hidden />}
          {busy ? 'Uploading…' : 'Upload a picture'}
        </button>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1}
               aria-label={`Choose a picture for ${label ?? placeholder ?? name}`}
               onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-12 w-auto max-w-[8rem] rounded border object-contain"
               style={{ borderColor: 'var(--mm-line)' }} />
        )}
      </div>
      {note && (
        <p className="mt-1 text-[13px]" role="status" style={{ color: note.bad ? 'var(--mm-warn)' : 'var(--mm-accent-strong)' }}>
          {note.text}
        </p>
      )}
      {help && <span className="mt-1 block text-[13px]" style={{ color: 'var(--mm-muted)' }}>{help}</span>}
    </div>
  )
}

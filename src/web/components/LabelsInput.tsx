import { useEffect, useState } from 'react'
import { Field } from './ui'

const parseLabels = (text: string) =>
  text
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)

/** Comma-separated label entry. */
export function LabelsInput({ label = 'Labels', value, onChange }: { label?: string; value: string[]; onChange: (labels: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  const key = value.join('\u0000')
  useEffect(() => {
    // sync เฉพาะเมื่อค่าเปลี่ยนจากภายนอก ไม่ใช่จากการพิมพ์ของผู้ใช้เอง
    if (parseLabels(text).join('\u0000') !== key) setText(value.join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <Field label={label} hint="Separate with commas.">
      {(id) => (
        <input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(parseLabels(e.target.value))
          }}
        />
      )}
    </Field>
  )
}

export function Labels({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null
  return (
    <span className="labels">
      {labels.map((l) => (
        <span key={l} className="label">
          {l}
        </span>
      ))}
    </span>
  )
}

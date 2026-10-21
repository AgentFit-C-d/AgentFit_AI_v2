'use client';
interface Field { key: string; label: string; nullable?: boolean; choices?: { value: string; label: string }[] }
export function DeclaredRows<T extends object>({ label, value, fields, emptyRow, onChange }: { label: string; value: T[] | null; fields: Field[]; emptyRow: T; onChange(value: T[] | null): void }) {
  const mode = value === null ? 'unknown' : value.length ? 'known' : 'none';
  return <fieldset className="declared-rows"><legend>{label}</legend>
    <label>{label} 상태<select value={mode} onChange={e => onChange(e.target.value === 'unknown' ? null : e.target.value === 'none' ? [] : [structuredClone(emptyRow)])}><option value="unknown">미정</option><option value="none">없음</option><option value="known">직접 입력</option></select></label>
    {mode === 'known' && value!.map((row, index) => <div key={index} className="declared-row"><div className="profile-grid">{fields.map(field => {
      const current = String((row as Record<string, unknown>)[field.key] ?? '');
      const change = (text: string) => onChange(value!.map((existing, at) => at === index ? { ...existing, [field.key]: field.nullable && !text ? null : text } : existing));
      const name = `${field.label} ${index + 1}`;
      return <label key={field.key}>{name}{field.choices ? <select value={current} onChange={e => change(e.target.value)}>{field.nullable && <option value="">미정</option>}{field.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : <input value={current} required={!field.nullable} onChange={e => change(e.target.value)} />}</label>;
    })}</div><button type="button" className="secondary" onClick={() => onChange(value!.filter((_row, at) => at !== index))}>{label} {index + 1} 제거</button></div>)}
    {value !== null && <button type="button" className="secondary" disabled={value.length >= 30} onClick={() => onChange([...value, structuredClone(emptyRow)])}>{label} 추가</button>}
  </fieldset>;
}

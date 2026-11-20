import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { list } from '../api/services';
import type { DataRow, Params } from '../api/types';
import { Issue, Modal } from './ui';

export interface Option { value: string | number; label: string }
export interface LookupConfig { resource: string; params?: Params; show?: string; valueKey?: string }
export interface Field {
  name: string; label: string; kind?: 'number' | 'money' | 'textarea' | 'checkbox' | 'select' | 'lookup' | 'date' | 'email' | 'url';
  required?: boolean; maxLength?: number; min?: number; max?: number; nullable?: boolean; options?: Option[];
  lookup?: LookupConfig; initial?: unknown; hint?: string;
}
export const options = (...values: string[]): Option[] => values.map((value) => ({ value, label: value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase()) }));
export const number = (name: string, label: string, min = 0, max = 1_000_000): Field => ({ name, label, kind: 'number', required: true, min, max });
export const select = (name: string, label: string, values: string[], initial?: string): Field => ({ name, label, kind: 'select', required: true, options: options(...values), initial });
export const lookup = (name: string, label: string, resource: string, params?: Params, show?: string): Field => ({ name, label, kind: 'lookup', required: true, lookup: { resource, params, show } });

export function Lookup({ config, value, onChange, label, disabled }: { config: LookupConfig; value: unknown; onChange: (value: string) => void; label: string; disabled?: boolean }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: [config.resource, 'picker', config.params, page], queryFn: ({ signal }) => list(config.resource, { ...config.params, page }, signal) });
  const results = query.data?.results || [];
  const valueKey = config.valueKey || 'id';
  const fallback = Boolean(value) && !results.some((row) => String(row[valueKey]) === String(value));
  return <span className="lookup">
    <select aria-label={label} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{query.isPending ? 'Loading…' : 'Select ' + label.toLowerCase()}</option>
      {fallback && <option value={String(value)}>#{String(value)}</option>}
      {results.map((row) => <option key={String(row.id)} value={String(row[valueKey])}>{String(row[config.show || 'name'] ?? '#' + row.id)}{row.sku ? ' · ' + row.sku : ''}</option>)}
    </select>
    {!disabled && (query.data?.next || page > 1) && <span className="lookup-pages">
      <button type="button" className="button small" disabled={!query.data?.previous} onClick={() => setPage(page - 1)} aria-label={'Previous ' + label + ' options'}>‹</button>
      <button type="button" className="button small" disabled={!query.data?.next} onClick={() => setPage(page + 1)} aria-label={'Next ' + label + ' options'}>›</button>
    </span>}
    {query.isError && <Issue error={query.error} retry={() => void query.refetch()} />}
  </span>;
}

function schemaFor(field: Field) {
  if (field.kind === 'checkbox') return z.boolean();
  return z.union([z.string(), z.number(), z.null()]).transform((input, ctx) => {
    const value = String(input ?? '').trim();
    const fail = (message: string) => { ctx.addIssue({ code: 'custom', message }); return z.NEVER; };
    if (value === '' && !field.required) {
      if (field.nullable) return null;
      return ['number', 'lookup', 'date', 'select', 'money'].includes(field.kind || '') ? undefined : '';
    }
    if (!value) return fail(field.label + ' is required');
    if (field.kind === 'number' || field.kind === 'lookup') {
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric) || numeric < (field.min ?? 1) || numeric > (field.max ?? Number.MAX_SAFE_INTEGER)) return fail('Enter a whole number in the allowed range');
      return numeric;
    }
    if (field.kind === 'money' && !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return fail('Enter a nonnegative amount with up to two decimal places');
    if (field.kind === 'email' && !z.email().safeParse(value).success) return fail('Enter a valid email');
    if (field.kind === 'url' && (!z.url().safeParse(value).success || !/^https?:\/\//i.test(value))) return fail('Enter an HTTP or HTTPS URL');
    if (field.maxLength && value.length > field.maxLength) return fail('Maximum length is ' + field.maxLength + ' characters');
    return value;
  });
}

export function Form({ fields, initial, save, children, submit = 'Save changes', done }: {
  fields: Field[]; initial?: DataRow; save: (data: DataRow) => Promise<unknown>; children?: ReactNode; submit?: string; done?: () => void;
}) {
  const cache = useQueryClient();
  const fieldId = useId();
  const [error, setError] = useState<unknown>();
  const schema = z.object(Object.fromEntries(fields.map((field) => [field.name, schemaFor(field)])));
  const values = Object.fromEntries(fields.map((field) => {
    const value = initial?.[field.name] ?? field.initial;
    if (field.kind === 'checkbox') return [field.name, Boolean(value)];
    return [field.name, typeof value === 'number' ? value : String(value ?? '')];
  }));
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: values });
  return <form className="data-form" aria-busy={form.formState.isSubmitting} noValidate onSubmit={form.handleSubmit(async (data) => {
    setError(undefined);
    try {
      await save(data);
      void cache.invalidateQueries();
      toast.success('Changes saved');
      done?.();
    } catch (failure) { setError(failure); }
  })}>
    <fieldset disabled={form.formState.isSubmitting}>
      {fields.map((field) => <label key={field.name} className={field.kind === 'checkbox' ? 'check-label' : ''}>
        {field.kind !== 'checkbox' && field.label}
        {field.kind === 'lookup' && field.lookup ? <Controller control={form.control} name={field.name} render={({ field: control }) =>
          <Lookup config={field.lookup!} value={control.value} onChange={control.onChange} label={field.label} />} />
          : field.kind === 'select' ? <select aria-label={field.label} aria-invalid={Boolean(form.formState.errors[field.name])} aria-describedby={form.formState.errors[field.name] ? fieldId + '-' + field.name : undefined} {...form.register(field.name)}><option value="">Choose…</option>{field.options?.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          : field.kind === 'textarea' ? <textarea aria-label={field.label} rows={3} {...form.register(field.name)} />
          : <input aria-label={field.label} aria-describedby={form.formState.errors[field.name] ? fieldId + '-' + field.name : undefined} type={field.kind === 'money' ? 'text' : field.kind === 'checkbox' ? 'checkbox' : field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'} inputMode={field.kind === 'money' ? 'decimal' : undefined} min={field.min} max={field.max} aria-invalid={Boolean(form.formState.errors[field.name])} {...form.register(field.name)} />}
        {field.kind === 'checkbox' && field.label}
        {field.hint && <small className="optional">{field.hint}</small>}
        {form.formState.errors[field.name] && <small id={fieldId + '-' + field.name} className="field-error">{String(form.formState.errors[field.name]?.message)}</small>}
      </label>)}
      {children}
    </fieldset>
    {Boolean(error) && <Issue error={error} />}
    <div className="form-actions"><button className="button primary" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : submit}</button></div>
  </form>;
}

export function Confirm({ title, detail, confirm, close }: { title: string; detail: string; confirm: () => Promise<unknown>; close: () => void }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return <Modal title={title} onClose={() => { if (!busy) close(); }}><p>{detail}</p>{Boolean(error) && <Issue error={error} />}
    <div className="form-actions"><button className="button" disabled={busy} onClick={close}>Go back</button><button className="button danger" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await confirm(); void cache.invalidateQueries(); toast.success('Changes saved'); close(); }
      catch (failure) { setError(failure); }
      finally { setBusy(false); }
    }}>{busy ? 'Working…' : 'Confirm'}</button></div>
  </Modal>;
}

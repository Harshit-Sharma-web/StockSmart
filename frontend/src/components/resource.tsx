import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowDownUp, ArrowUp, Plus, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { detail, list, write, type Resource } from '../api/services';
import type { DataRow, Params } from '../api/types';
import { api } from '../api/client';
import { Confirm, Form, Lookup, type Field, type LookupConfig, type Option } from './forms';
import { Badge, Empty, Header, Issue, Loading, Modal, Pager, format } from './ui';
import { useAuth } from '../features/auth';

export interface Column { key: string; label: string; status?: boolean; sort?: boolean; render?: (row: DataRow) => ReactNode }
export interface Filter { key: string; label: string; options?: Option[]; lookup?: LookupConfig; type?: 'number' | 'date' }
export interface ResourceConfig {
  title: string; description: string; singular: string; route: string; resource: Resource; columns: Column[];
  filters?: Filter[]; search?: boolean; fields?: Field[]; editFields?: Field[]; deleteLabel?: string;
  writeRole?: 'admin' | 'operator' | 'catalog'; sort?: string; create?: boolean;
  detailExtra?: (row: DataRow) => ReactNode; fixed?: Params;
}
export function useMetadata(resource: string, enabled: boolean, method: 'POST' | 'PUT') {
  return useQuery({
    queryKey: [resource, 'metadata', method], enabled, retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.options<{ actions?: Record<string, unknown> }>(resource + '/', { signal });
      return Boolean(data.actions?.[method]);
    },
  }).data;
}
export function FilterInput({ filter, value, set }: { filter: Filter; value: string; set: (value: string) => void }) {
  return <label className="filter-field"><span>{filter.label}</span>
    {filter.lookup ? <Lookup config={filter.lookup} value={value} onChange={set} label={filter.label} />
      : filter.options ? <select aria-label={filter.label} value={value} onChange={(event) => set(event.target.value)}>
        <option value="">All</option>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input type={filter.type || 'text'} aria-label={filter.label} value={value} onChange={(event) => set(event.target.value)} />}
  </label>;
}
export function Rows({ rows, columns, link, ordering, onSort }: {
  rows: DataRow[]; columns: Column[]; link?: (row: DataRow) => string; ordering?: string; onSort?: (column: string) => void;
}) {
  if (!rows.length) return <Empty />;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.key}>
    {column.sort && onSort ? <button type="button" className="table-sort" onClick={() => onSort(column.key)}>{column.label}{ordering === column.key ? <ArrowUp size={13} /> : ordering === '-' + column.key ? <ArrowDown size={13} /> : <ArrowDownUp size={13} />}</button> : column.label}</th>)}
    {link && <th><span className="sr-only">Details</span></th>}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column, position) => <td key={column.key}>
      {column.render ? column.render(row) : column.status ? <Badge value={row[column.key]} /> : position === 0 && link ? <Link className="row-link" to={link(row)}>{format(row[column.key])}</Link> : format(row[column.key])}
    </td>)}{link && <td className="table-action"><Link to={link(row)} aria-label={'View record ' + row.id}>View <span aria-hidden>↗</span></Link></td>}</tr>)}</tbody>
  </table></div>;
}
export function ResourceIndex({ config, extra, action }: { config: ResourceConfig; extra?: ReactNode; action?: ReactNode }) {
  const { role } = useAuth();
  const meta = useMetadata(config.resource, config.writeRole === 'catalog' && role === 'manager', 'POST');
  const allow = Boolean(config.fields && config.create !== false && (role === 'admin' || config.writeRole === 'operator' || meta));
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState(params.get('search') || '');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const ordering = params.get('ordering') || config.sort;
  const filters = Object.fromEntries((config.filters || []).map((filter) => [filter.key, params.get(filter.key) || undefined]));
  const query = useQuery({ queryKey: [config.resource, filters, ordering, page, params.get('search'), config.fixed], queryFn: ({ signal }) =>
    list(config.resource, { ...filters, ...config.fixed, page, ordering, search: config.search ? params.get('search') || undefined : undefined }, signal) });
  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }
  return <>
    <Header title={config.title} description={config.description} actions={<>{action}{allow && <button className="button primary" onClick={() => setCreate(true)}><Plus size={17} /> Add {config.singular.toLowerCase()}</button>}</>} />
    {extra}
    <section className="panel data-panel">
      {(config.search || Boolean(config.filters?.length)) && <div className="toolbar">
        {config.search && <form className="search-box" onSubmit={(event) => { event.preventDefault(); set('search', search.trim()); }}>
          <Search size={17} /><input aria-label={'Search ' + config.title.toLowerCase()} placeholder={'Search ' + config.title.toLowerCase() + '…'} value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button small" type="submit">Search</button>
        </form>}
        {config.filters?.map((filter) => <FilterInput key={filter.key} filter={filter} value={params.get(filter.key) || ''} set={(value) => set(filter.key, value)} />)}
      </div>}
      {query.isPending && <Loading />}
      {query.isError && <Issue error={query.error} retry={() => void query.refetch()} />}
      {query.data && <><Rows rows={query.data.results} columns={config.columns} link={(row) => config.route + '/' + row.id}
        ordering={ordering} onSort={(column) => set('ordering', ordering === column ? '-' + column : column)} />
        <Pager data={query.data} page={page} setPage={(value) => set('page', String(value))} /></>}
    </section>
    {create && <Modal title={'Add ' + config.singular.toLowerCase()} onClose={() => setCreate(false)}><Form fields={config.fields!} save={(data) => write('post', config.resource + '/', data)} submit={'Create ' + config.singular.toLowerCase()} done={() => setCreate(false)} /></Modal>}
  </>;
}

export function Facts({ row, columns }: { row: DataRow; columns: Column[] }) {
  return <dl className="facts">{columns.map((column) => <div key={column.key}><dt>{column.label}</dt><dd>{column.render ? column.render(row) : column.status ? <Badge value={row[column.key]} /> : format(row[column.key])}</dd></div>)}</dl>;
}
export function ResourceDetail({ config, id }: { config: ResourceConfig; id: number }) {
  const { role, profile } = useAuth();
  const query = useQuery({ queryKey: [config.resource, id], queryFn: ({ signal }) => detail(config.resource, id, signal) });
  const canEdit = useMetadata(config.resource + '/' + id, config.writeRole === 'catalog' && role === 'manager', 'PUT');
  const [modal, setModal] = useState<'edit' | 'delete'>();
  const path = config.resource + '/' + id + '/';
  const allowed = role === 'admin' || config.writeRole === 'operator' || canEdit;
  const row = query.data;
  return <>
    <Link className="back-link" to={config.route}>← {config.title}</Link>
    <Header title={row?.name ? String(row.name) : config.singular + ' #' + id} actions={row && allowed && <>
      {(config.editFields || config.fields) && !(config.resource === 'users' && profile?.id === id) && <button className="button primary" onClick={() => setModal('edit')}>Edit {config.singular.toLowerCase()}</button>}
      {config.deleteLabel && (role === 'admin' || config.writeRole === 'operator') && row.active !== false && <button className="button" onClick={() => setModal('delete')}>{config.deleteLabel}</button>}
    </>} />
    {query.isPending && <Loading />}
    {query.isError && <Issue error={query.error} retry={() => void query.refetch()} />}
    {row && <><section className="panel detail-panel"><Facts row={row} columns={config.columns} />
      {(config.editFields || config.fields) && <Facts row={row} columns={(config.editFields || config.fields || []).filter((field) => !config.columns.some((column) => column.key === field.name)).map((field) => ({ key: field.name, label: field.label }))} />}</section>
      {config.detailExtra?.(row)}
      {modal === 'edit' && <Modal title={'Edit ' + config.singular.toLowerCase()} onClose={() => setModal(undefined)}><Form fields={config.editFields || config.fields || []} initial={row} save={(data) => write('patch', path, data)} done={() => setModal(undefined)} /></Modal>}
      {modal === 'delete' && <Confirm title={config.deleteLabel!} detail="Apply this change to the selected record?" confirm={() => write('delete', path)} close={() => { setModal(undefined); }} />}
    </>}
  </>;
}

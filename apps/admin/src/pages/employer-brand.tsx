import Select from '@douyinfe/semi-ui/lib/es/select';
import { ArrowLeft, Building2, Plus, Search, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, dateTime } from '@/lib/api';

const categories = [
  { value: 'company_introduction', label: '公司简介' },
  { value: 'culture', label: '企业文化' },
  { value: 'benefits', label: '福利待遇' },
  { value: 'team', label: '团队介绍' },
  { value: 'office', label: '办公环境' },
  { value: 'history', label: '发展历程' },
  { value: 'recruiting', label: '招聘宣传' },
] as const;

const industries = [
  '互联网/IT/软件',
  '电子商务',
  '游戏/动漫',
  '通信/电子',
  '人工智能/大数据',
  '制造业',
  '汽车/新能源',
  '航空/航天',
  '医药/医疗健康',
  '生物科技',
  '金融/投资/保险',
  '房地产/建筑',
  '教育/培训',
  '文化/传媒/广告',
  '影视/娱乐',
  '零售/批发',
  '消费品/快消',
  '餐饮/酒店/旅游',
  '物流/供应链',
  '能源/电力/环保',
  '农业/渔业',
  '咨询/专业服务',
  '法律/会计',
  '人力资源',
  '政府机关/事业单位',
  '其他',
];

type Enterprise = {
  id: number;
  name: string;
  industry: string;
  introduction: string;
  remark: string;
  sort_order: number;
  enabled: boolean;
  deleted_at: string | null;
  endorsement_count: number;
  completed_categories: number;
  updated_at: string;
};
type Endorsement = {
  id: number;
  enterprise_id: number | null;
  enterprise_name: string;
  enterprise_deleted: boolean;
  category: (typeof categories)[number]['value'];
  category_label: string;
  title: string;
  body: string;
  sort_order: number;
  enabled: boolean;
  updated_at: string;
};
type Workspace = {
  enterprise_limit: number;
  enterprises: Enterprise[];
  deleted_enterprises: Enterprise[];
  endorsements: Endorsement[];
  deleted_endorsements: Endorsement[];
};
type EnterpriseForm = {
  id?: number;
  name: string;
  industry: string;
  introduction: string;
  remark: string;
  sort_order: number;
  enabled: boolean;
};
type EndorsementForm = {
  id?: number;
  enterprise_id: number | null;
  category: Endorsement['category'];
  title: string;
  body: string;
  sort_order: number;
  enabled: boolean;
};
type ModalState =
  | { kind: 'enterprise'; draft: EnterpriseForm }
  | { kind: 'endorsement'; draft: EndorsementForm }
  | null;

function enterpriseCode(id: number) {
  return `E${String(id).padStart(4, '0')}`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const quote = (value: unknown) => {
    const text = String(value ?? '');
    return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
  };
  const csv = rows.map((row) => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadEnterprises(rows: Enterprise[]) {
  const columns: [keyof Enterprise, string][] = [
    ['id', '企业编号'],
    ['name', '企业名称'],
    ['industry', '行业'],
    ['introduction', '企业简介'],
    ['remark', '备注'],
    ['sort_order', '排序'],
    ['enabled', '状态'],
    ['endorsement_count', '背书内容数'],
    ['completed_categories', '已补充分类数'],
  ];
  downloadCsv('企业列表', [
    columns.map(([, label]) => label),
    ...rows.map((row) =>
      columns.map(([key]) =>
        key === 'id'
          ? enterpriseCode(row.id)
          : key === 'enabled'
            ? row.enabled
              ? '已启用'
              : '已停用'
            : row[key],
      ),
    ),
  ]);
}

export function EmployerBrandPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState('');
  const [formError, setFormError] = useState('');
  const [aiNotice, setAiNotice] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialDraft = useRef('');
  const suggestionRequest = useRef<AbortController | null>(null);
  const dirty = !!modal && JSON.stringify(modal.draft) !== initialDraft.current;

  const load = useCallback(async () => {
    setError('');
    try {
      setWorkspace(await api<Workspace>('employer-brand/'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modal && !dialog.open) dialog.showModal();
    if (!modal && dialog.open) dialog.close();
  }, [modal]);

  useEffect(() => () => suggestionRequest.current?.abort(), []);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  const enterprises = workspace?.enterprises ?? [];
  const deletedEnterprises = workspace?.deleted_enterprises ?? [];
  const endorsements = workspace?.endorsements ?? [];
  const deletedEndorsements = workspace?.deleted_endorsements ?? [];
  const selectedEnterprise = enterprises.find((item) => item.id === selectedEnterpriseId) ?? null;
  const visibleEnterprises = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return enterprises.filter((item) => {
      const matchesSearch =
        !keyword ||
        [item.name, item.industry, enterpriseCode(item.id)].some((value) =>
          String(value).toLocaleLowerCase().includes(keyword),
        );
      const matchesStatus =
        status === 'all' || (status === 'enabled' ? item.enabled : !item.enabled);
      return matchesSearch && matchesStatus;
    });
  }, [enterprises, search, status]);

  function openModal(next: NonNullable<ModalState>) {
    if (busy) return;
    setFormError('');
    setAiNotice('');
    initialDraft.current = JSON.stringify(next.draft);
    setModal(next);
  }

  function openEnterpriseForm(item?: Enterprise) {
    openModal({
      kind: 'enterprise',
      draft: {
        id: item?.id,
        name: item?.name ?? '',
        industry: item?.industry ?? '',
        introduction: item?.introduction ?? '',
        remark: item?.remark ?? '',
        sort_order: item?.sort_order ?? 0,
        enabled: item?.enabled ?? true,
      },
    });
  }

  function openEndorsementForm(category: Endorsement['category'], item?: Endorsement) {
    openModal({
      kind: 'endorsement',
      draft: {
        id: item?.id,
        enterprise_id: item?.enterprise_deleted
          ? null
          : (item?.enterprise_id ?? selectedEnterpriseId),
        category: item?.category ?? category,
        title: item?.title ?? '',
        body: item?.body ?? '',
        sort_order: item?.sort_order ?? 0,
        enabled: item?.enabled ?? true,
      },
    });
  }

  function cancelSuggestion() {
    suggestionRequest.current?.abort();
    suggestionRequest.current = null;
    if (busy === 'suggest') setBusy('');
  }

  function dismissModal() {
    cancelSuggestion();
    setModal(null);
    setFormError('');
    setAiNotice('');
  }

  function closeModal() {
    if (busy === 'save') return;
    if (dirty && !window.confirm('填写的内容尚未保存，确定放弃修改并关闭吗？')) return;
    dismissModal();
  }

  async function suggestEnterprise() {
    if (modal?.kind !== 'enterprise' || busy) return;
    if (modal.draft.name.trim().length < 2) {
      setFormError('请先填写企业名称（至少 2 个字），再点 AI 联想。');
      return;
    }
    setBusy('suggest');
    setFormError('');
    setAiNotice('');
    const controller = new AbortController();
    suggestionRequest.current = controller;
    const name = modal.draft.name.trim();
    try {
      const suggestion = await api<{ industry: string; introduction: string }>(
        'employer-brand/enterprise-suggestion/',
        { name, industry: modal.draft.industry },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!suggestion.industry && !suggestion.introduction) {
        setFormError('AI 暂时无法形成可靠建议，表单内容未更改。');
        return;
      }
      setModal((current) => {
        if (current?.kind !== 'enterprise' || current.draft.name.trim() !== name) return current;
        return {
          ...current,
          draft: {
            ...current.draft,
            industry: current.draft.industry.trim() ? current.draft.industry : suggestion.industry,
            introduction: current.draft.introduction.trim()
              ? current.draft.introduction
              : suggestion.introduction,
          },
        };
      });
      setAiNotice('AI 建议已返回，仅补充空白的行业和简介，已填写内容保留。请核对后保存。');
    } catch (e) {
      if (!controller.signal.aborted) setFormError((e as Error).message);
    } finally {
      if (suggestionRequest.current === controller) {
        suggestionRequest.current = null;
        setBusy('');
      }
    }
  }

  async function saveModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || busy) return;
    if (modal.kind === 'endorsement' && modal.draft.enterprise_id === null) {
      setFormError('请选择所属企业。');
      return;
    }
    setBusy('save');
    setFormError('');
    setNotice('');
    try {
      if (modal.kind === 'enterprise') {
        await api('employer-brand/enterprises/save/', {
          ...modal.draft,
          name: modal.draft.name.trim(),
          industry: modal.draft.industry.trim(),
          introduction: modal.draft.introduction.trim(),
          remark: modal.draft.remark.trim(),
        });
        setNotice(modal.draft.id ? '企业档案已更新。' : '企业档案已创建。');
      } else {
        await api('employer-brand/endorsements/save/', {
          ...modal.draft,
          title: modal.draft.title.trim(),
          body: modal.draft.body.trim(),
        });
        setNotice('背书内容已保存。');
      }
      dismissModal();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function toggleEnterprise(item: Enterprise) {
    if (busy) return;
    setBusy(`toggle-${item.id}`);
    setError('');
    setNotice('');
    try {
      await api('employer-brand/enterprises/save/', {
        id: item.id,
        enabled: !item.enabled,
      });
      setNotice(item.enabled ? '企业已停用，不再进入 AI 初面的企业选项。' : '企业已启用。');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function deleteEnterprise(item: Enterprise) {
    if (busy) return;
    if (
      !window.confirm(
        `删除「${item.name}」后，已有背书内容仍会保留在“未归属 / 已删除企业”中，可再指定给其他企业。确定删除吗？`,
      )
    )
      return;
    setBusy(`delete-${item.id}`);
    setError('');
    setNotice('');
    try {
      await api(`employer-brand/enterprises/${item.id}/delete/`, {});
      if (selectedEnterpriseId === item.id) setSelectedEnterpriseId(null);
      setNotice('企业已移入已删除企业，背书内容已保留。');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function manageEndorsement(item: Endorsement, action: 'toggle' | 'delete' | 'restore') {
    if (busy) return;
    if (
      action === 'delete' &&
      !window.confirm(
        `将「${item.title || item.category_label}」移入内容回收站？移入后不再用于 AI 初面，可随时恢复。`,
      )
    )
      return;
    setBusy(`content-${item.id}`);
    setError('');
    setNotice('');
    try {
      if (action === 'toggle') {
        await api('employer-brand/endorsements/save/', { id: item.id, enabled: !item.enabled });
        setNotice(
          item.enabled
            ? '内容已停用，不再用于 AI 初面。'
            : '内容已启用；所属企业启用后可用于 AI 初面。',
        );
      } else {
        await api(`employer-brand/endorsements/${item.id}/${action}/`, {});
        setNotice(
          action === 'delete'
            ? '内容已移入回收站，可在下方恢复。'
            : item.enterprise_deleted || !item.enterprise_id
              ? '内容已恢复到「未归属 / 已删除企业」，请重新指定企业。'
              : '内容已恢复，保留原分类、排序和启用状态。',
        );
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (loading) return <Loading />;
  if (error && !workspace) return <ErrorNotice message={error} retry={() => void load()} />;

  const orphaned = endorsements.filter(
    (item) => item.enterprise_deleted || item.enterprise_id === null,
  );
  const orphanGroups = [
    ...deletedEnterprises.map((item) => ({
      id: item.id,
      name: item.name,
      items: orphaned.filter((content) => content.enterprise_id === item.id),
    })),
    ...(orphaned.some((item) => item.enterprise_id === null)
      ? [
          {
            id: null,
            name: '未归属企业',
            items: orphaned.filter((item) => item.enterprise_id === null),
          },
        ]
      : []),
  ];
  const visibleDeletedEndorsements = deletedEndorsements.filter(
    (item) => !selectedEnterprise || item.enterprise_id === selectedEnterprise.id,
  );

  return (
    <section className="enterprise-brand-page" aria-labelledby="enterprise-brand-title">
      {error && <ErrorNotice message={error} retry={() => void load()} />}
      {notice && (
        <Alert role="status">
          <AlertTitle>企业背书</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {selectedEnterprise ? (
        <>
          <header className="brand-page-heading">
            <div className="brand-page-title-row">
              <Button variant="ghost" size="sm" onClick={() => setSelectedEnterpriseId(null)}>
                <ArrowLeft data-icon="inline-start" />
                返回企业列表
              </Button>
              <div className="brand-heading-actions">
                <Button variant="outline" onClick={() => openEnterpriseForm(selectedEnterprise)}>
                  编辑企业
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv(`${enterpriseCode(selectedEnterprise.id)}-背书内容`, [
                      ['企业编号', '企业名称', '分类', '标题', '正文', '展示顺序', '状态'],
                      ...endorsements
                        .filter((item) => item.enterprise_id === selectedEnterprise.id)
                        .map((item) => [
                          enterpriseCode(selectedEnterprise.id),
                          selectedEnterprise.name,
                          item.category_label,
                          item.title,
                          item.body,
                          item.sort_order,
                          item.enabled ? '已启用' : '已停用',
                        ]),
                    ])
                  }
                >
                  导出该企业内容
                </Button>
                <Button onClick={() => openEndorsementForm('company_introduction')}>
                  新增内容
                </Button>
              </div>
            </div>
            <div>
              <h1 id="enterprise-brand-title">{selectedEnterprise.name}</h1>
              <div className="enterprise-profile-meta">
                <Badge variant={selectedEnterprise.enabled ? 'secondary' : 'outline'}>
                  {selectedEnterprise.enabled ? '已启用' : '已停用'}
                </Badge>
                <span className="enterprise-profile-code">
                  {enterpriseCode(selectedEnterprise.id)}
                </span>
                <span>{selectedEnterprise.industry || '行业待补充'}</span>
                <p className="enterprise-profile-introduction">
                  {selectedEnterprise.introduction || '企业简介待补充。'}
                </p>
              </div>
            </div>
          </header>
          <div className="brand-detail-summary">
            <span>
              已补充{' '}
              <strong>
                {selectedEnterprise.completed_categories}/{categories.length}
              </strong>{' '}
              类 · {selectedEnterprise.endorsement_count} 条内容
            </span>
            <span>
              {selectedEnterprise.enabled
                ? '启用的内容可用于 AI 初面'
                : '企业已停用，以下内容暂不用于 AI 初面'}
            </span>
          </div>
          <div className="endorsement-category-grid">
            {categories.map((category) => {
              const rows = endorsements.filter(
                (item) =>
                  item.enterprise_id === selectedEnterprise.id && item.category === category.value,
              );
              return (
                <section className="endorsement-category-card" key={category.value}>
                  <div className="endorsement-category-heading">
                    <div>
                      <h2>{category.label}</h2>
                      <span className="endorsement-category-count">{rows.length} 条</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEndorsementForm(category.value)}
                    >
                      <Plus data-icon="inline-start" />
                      新增
                    </Button>
                  </div>
                  {rows.length ? (
                    <div className="endorsement-items">
                      {rows.map((item) => (
                        <article className="endorsement-item" key={item.id}>
                          <div className="endorsement-item-heading">
                            <h3>{item.title || '待补充'}</h3>
                            <div className="endorsement-item-actions">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!!busy}
                                onClick={() => openEndorsementForm(category.value, item)}
                              >
                                编辑
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!!busy}
                                onClick={() => void manageEndorsement(item, 'toggle')}
                              >
                                {item.enabled ? '停用' : '启用'}
                              </Button>
                              <Button
                                className="brand-danger-action"
                                variant="ghost"
                                size="sm"
                                disabled={!!busy}
                                onClick={() => void manageEndorsement(item, 'delete')}
                              >
                                删除
                              </Button>
                            </div>
                          </div>
                          <div className="endorsement-item-meta">
                            <Badge variant={item.enabled ? 'secondary' : 'outline'}>
                              {item.enabled ? '已启用' : '已停用'}
                            </Badge>
                            <span>
                              顺序 {item.sort_order} · 更新于 {dateTime(item.updated_at)}
                            </span>
                          </div>
                          <p>{item.body || '正文待补充。'}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="endorsement-empty">待补充</p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <header className="brand-page-heading">
            <div className="brand-page-title-row">
              <div>
                <h1 id="enterprise-brand-title">企业背书</h1>
                <p>按企业分组：先建企业档案，再为每家企业补充七类背书内容</p>
              </div>
              <div className="brand-heading-actions">
                <Button
                  variant="outline"
                  disabled={!enterprises.length}
                  onClick={() => downloadEnterprises(enterprises)}
                >
                  导出企业列表
                </Button>
                <Button
                  disabled={enterprises.length >= (workspace?.enterprise_limit ?? 20)}
                  onClick={() => openEnterpriseForm()}
                >
                  新增企业
                </Button>
              </div>
            </div>
          </header>

          <p className="brand-empty-content-note">
            背书内容全部留空并标注「待补充」，不预置任何企业信息；企业档案由你自己创建。
          </p>

          <section className="brand-list-panel" aria-label="企业列表">
            <div className="brand-list-filters">
              <div className="brand-search">
                <Search aria-hidden="true" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索企业名称 / 行业 / 编号..."
                  aria-label="搜索企业名称、行业或编号"
                />
              </div>
              <span id="brand-status-label" className="sr-only">
                按企业状态筛选
              </span>
              <Select
                className="native-select w-full"
                dropdownClassName="candidate-select-dropdown"
                clickToHide
                value={status}
                onChange={(value) => setStatus(typeof value === 'string' ? value : 'all')}
                aria-labelledby="brand-status-label"
              >
                <Select.Option value="all">全部状态</Select.Option>
                <Select.Option value="enabled">已启用</Select.Option>
                <Select.Option value="disabled">已停用</Select.Option>
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                }}
              >
                重置
              </Button>
            </div>
            {visibleEnterprises.length ? (
              <div className="enterprise-card-grid">
                {visibleEnterprises.map((item) => (
                  <article className="enterprise-card" key={item.id}>
                    <button
                      className="enterprise-card-open"
                      type="button"
                      onClick={() => setSelectedEnterpriseId(item.id)}
                    >
                      <strong title={item.name}>{item.name}</strong>
                      <Badge variant={item.enabled ? 'secondary' : 'outline'}>
                        {item.enabled ? '已启用' : '已停用'}
                      </Badge>
                      <span className="enterprise-card-code">{enterpriseCode(item.id)}</span>
                      <span className="enterprise-card-progress">
                        {item.industry || '行业待补充'} · {item.endorsement_count} 条内容 · 已填充{' '}
                        {item.completed_categories}/{categories.length} 类
                      </span>
                    </button>
                    <div className="enterprise-card-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => openEnterpriseForm(item)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void toggleEnterprise(item)}
                      >
                        {busy === `toggle-${item.id}` ? '处理中…' : item.enabled ? '停用' : '启用'}
                      </Button>
                      <Button
                        className="enterprise-card-delete"
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void deleteEnterprise(item)}
                      >
                        删除
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : enterprises.length ? (
              <div className="brand-empty-state">
                <Building2 aria-hidden="true" />
                <h2>没有符合条件的企业</h2>
                <p>试试调整关键词或状态筛选。</p>
              </div>
            ) : (
              <div className="brand-empty-state">
                <Building2 aria-hidden="true" />
                <h2>还没有企业档案</h2>
                <p>先建企业档案，再为它补充七类背书内容</p>
              </div>
            )}
            <p className="brand-list-tip">
              每租户最多 {workspace?.enterprise_limit ?? 20}{' '}
              个企业档案。删除企业不会删除其下背书内容，原内容会转入「未归属 /
              已删除企业」卡片，可随时重新指定所属企业。
            </p>
          </section>

          {orphanGroups.length > 0 && (
            <section className="brand-orphan-panel" aria-labelledby="brand-orphan-title">
              <div className="brand-orphan-heading">
                <div>
                  <h2 id="brand-orphan-title">未归属 / 已删除企业</h2>
                  <p>内容仍会保留；编辑内容时可以重新指定所属企业。</p>
                </div>
                <Badge variant="outline">{orphaned.length} 条内容</Badge>
              </div>
              {!enterprises.length && orphaned.length > 0 && (
                <div className="brand-detail-summary">
                  <span>先创建企业档案，再将保留内容指定给该企业。</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => openEnterpriseForm()}
                  >
                    新增企业
                  </Button>
                </div>
              )}
              {orphanGroups.map((group) => (
                <div className="brand-orphan-group" key={group.id ?? 'unassigned'}>
                  <h3>{group.name}</h3>
                  {group.items.length ? (
                    group.items.map((item) => (
                      <article className="brand-orphan-item" key={item.id}>
                        <div>
                          <strong>
                            {item.category_label} · {item.title || '待补充'}
                          </strong>
                          <p>{item.body || '正文待补充。'}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy || !enterprises.length}
                          onClick={() => openEndorsementForm(item.category, item)}
                        >
                          重新指定
                        </Button>
                      </article>
                    ))
                  ) : (
                    <p className="endorsement-empty">尚无背书内容。</p>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {visibleDeletedEndorsements.length > 0 && (
        <details className="brand-recycle-panel">
          <summary>
            <Trash2 aria-hidden="true" />
            内容回收站 <span>{visibleDeletedEndorsements.length} 条</span>
          </summary>
          <p>删除的内容不会用于 AI 初面。恢复后保留原所属企业、分类与启用状态。</p>
          {visibleDeletedEndorsements.map((item) => (
            <article className="brand-orphan-item" key={item.id}>
              <div>
                <strong>{item.title || '待补充'}</strong>
                <p>
                  {item.enterprise_name || '未归属企业'} · {item.category_label}
                  {item.enterprise_deleted ? ' · 企业已删除' : ''}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => void manageEndorsement(item, 'restore')}
              >
                恢复
              </Button>
            </article>
          ))}
        </details>
      )}

      <dialog
        ref={dialogRef}
        className={`enterprise-dialog${modal?.kind === 'enterprise' ? ' enterprise-profile-dialog' : ''}`}
        aria-labelledby="enterprise-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeModal();
        }}
      >
        {modal && (
          <form onSubmit={(event) => void saveModal(event)}>
            <div className="enterprise-dialog-heading">
              <div>
                <h2 id="enterprise-dialog-title">
                  {modal.kind === 'enterprise'
                    ? modal.draft.id
                      ? '编辑企业'
                      : '新增企业'
                    : modal.draft.id
                      ? '编辑内容'
                      : '新增内容'}
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="关闭"
                disabled={busy === 'save'}
                onClick={closeModal}
              >
                ×
              </Button>
            </div>
            <div className="enterprise-dialog-body">
              <div className="enterprise-form-fields" aria-busy={busy === 'save'}>
                {formError && (
                  <p className="enterprise-form-error" role="alert">
                    {formError}
                  </p>
                )}
                {modal.kind === 'enterprise' ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="enterprise-name">企业名称 *</FieldLabel>
                      <div className="enterprise-name-row">
                        <Input
                          id="enterprise-name"
                          disabled={busy === 'save'}
                          required
                          maxLength={100}
                          autoFocus
                          value={modal.draft.name}
                          placeholder="用户自行填写，不预置任何企业名"
                          onChange={(event) => {
                            cancelSuggestion();
                            setAiNotice('');
                            setModal({
                              ...modal,
                              draft: { ...modal.draft, name: event.target.value },
                            });
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            !!busy ||
                            !!(modal.draft.industry.trim() && modal.draft.introduction.trim())
                          }
                          onClick={() => void suggestEnterprise()}
                        >
                          {busy === 'suggest' ? '联想中…' : 'AI 联想'}
                        </Button>
                      </div>
                      <FieldDescription>AI 仅补充空白的行业与简介，核对后再保存。</FieldDescription>
                    </Field>
                    <div className="enterprise-form-two-columns">
                      <Field>
                        <FieldLabel id="enterprise-industry-label" htmlFor="enterprise-industry">
                          行业（选填）
                        </FieldLabel>
                        <Select
                          id="enterprise-industry"
                          getPopupContainer={() => dialogRef.current ?? document.body}
                          disabled={busy === 'save'}
                          aria-labelledby="enterprise-industry-label"
                          className="enterprise-industry-select native-select w-full"
                          dropdownClassName="candidate-select-dropdown"
                          value={modal.draft.industry}
                          placeholder="点击选择，或直接输入"
                          filter
                          allowCreate
                          clickToHide
                          onChange={(value) => {
                            cancelSuggestion();
                            setAiNotice('');
                            setModal({
                              ...modal,
                              draft: {
                                ...modal.draft,
                                industry: typeof value === 'string' ? value : '',
                              },
                            });
                          }}
                        >
                          {industries.map((industry) => (
                            <Select.Option key={industry} value={industry}>
                              {industry}
                            </Select.Option>
                          ))}
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="enterprise-order">排序</FieldLabel>
                        <Input
                          id="enterprise-order"
                          disabled={busy === 'save'}
                          type="number"
                          min={0}
                          max={100000}
                          value={modal.draft.sort_order}
                          onChange={(event) =>
                            setModal({
                              ...modal,
                              draft: {
                                ...modal.draft,
                                sort_order: Number(event.target.value) || 0,
                              },
                            })
                          }
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="enterprise-introduction">企业简介（选填）</FieldLabel>
                      <Input
                        id="enterprise-introduction"
                        disabled={busy === 'save'}
                        maxLength={3000}
                        value={modal.draft.introduction}
                        placeholder="一句话介绍该企业的主营业务，可由 AI 联想生成"
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, introduction: event.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="enterprise-remark">备注（选填）</FieldLabel>
                      <Input
                        id="enterprise-remark"
                        disabled={busy === 'save'}
                        maxLength={2000}
                        value={modal.draft.remark}
                        placeholder="内部备注，不对外展示"
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, remark: event.target.value },
                          })
                        }
                      />
                    </Field>
                    <label className="enterprise-enabled-option">
                      <input
                        type="checkbox"
                        disabled={busy === 'save'}
                        checked={modal.draft.enabled}
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, enabled: event.target.checked },
                          })
                        }
                      />
                      启用（停用后不进入 AI 初面的企业选项）
                    </label>
                  </FieldGroup>
                ) : (
                  <FieldGroup>
                    <Field>
                      <FieldLabel
                        id="endorsement-enterprise-label"
                        htmlFor="endorsement-enterprise"
                      >
                        所属企业 *
                      </FieldLabel>
                      <Select
                        id="endorsement-enterprise"
                        getPopupContainer={() => dialogRef.current ?? document.body}
                        disabled={busy === 'save'}
                        aria-labelledby="endorsement-enterprise-label"
                        className="native-select w-full"
                        dropdownClassName="candidate-select-dropdown"
                        clickToHide
                        placeholder="请选择所属企业"
                        value={
                          modal.draft.enterprise_id === null
                            ? ''
                            : String(modal.draft.enterprise_id)
                        }
                        aria-required
                        onChange={(value) => {
                          setFormError('');
                          setModal({
                            ...modal,
                            draft: {
                              ...modal.draft,
                              enterprise_id:
                                value !== '' && value !== undefined ? Number(value) : null,
                            },
                          });
                        }}
                      >
                        {enterprises.map((item) => (
                          <Select.Option key={item.id} value={String(item.id)}>
                            {item.name}
                          </Select.Option>
                        ))}
                      </Select>
                      <FieldDescription>
                        选项来自企业档案；删除的企业其内容会保留，可在此重新指定。
                      </FieldDescription>
                    </Field>
                    <div className="enterprise-form-two-columns">
                      <Field>
                        <FieldLabel id="endorsement-category-label" htmlFor="endorsement-category">
                          分类 *
                        </FieldLabel>
                        <Select
                          id="endorsement-category"
                          getPopupContainer={() => dialogRef.current ?? document.body}
                          disabled={busy === 'save'}
                          aria-labelledby="endorsement-category-label"
                          className="native-select w-full"
                          dropdownClassName="candidate-select-dropdown"
                          clickToHide
                          value={modal.draft.category}
                          onChange={(value) =>
                            setModal({
                              ...modal,
                              draft: {
                                ...modal.draft,
                                category: value as Endorsement['category'],
                              },
                            })
                          }
                        >
                          {categories.map((item) => (
                            <Select.Option key={item.value} value={item.value}>
                              {item.label}
                            </Select.Option>
                          ))}
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="endorsement-title">标题（选填）</FieldLabel>
                        <Input
                          id="endorsement-title"
                          disabled={busy === 'save'}
                          maxLength={200}
                          value={modal.draft.title}
                          placeholder="待补充"
                          onChange={(event) =>
                            setModal({
                              ...modal,
                              draft: { ...modal.draft, title: event.target.value },
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="enterprise-form-two-columns">
                      <Field>
                        <FieldLabel htmlFor="endorsement-order">展示顺序</FieldLabel>
                        <Input
                          id="endorsement-order"
                          disabled={busy === 'save'}
                          type="number"
                          min={0}
                          max={100000}
                          value={modal.draft.sort_order}
                          onChange={(event) =>
                            setModal({
                              ...modal,
                              draft: {
                                ...modal.draft,
                                sort_order: Number(event.target.value) || 0,
                              },
                            })
                          }
                        />
                        <FieldDescription>数字越小越靠前</FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel>是否启用</FieldLabel>
                        <label className="enterprise-enabled-option">
                          <input
                            type="checkbox"
                            disabled={busy === 'save'}
                            checked={modal.draft.enabled}
                            onChange={(event) =>
                              setModal({
                                ...modal,
                                draft: { ...modal.draft, enabled: event.target.checked },
                              })
                            }
                          />
                          启用
                        </label>
                        <FieldDescription>停用后不进入 AI 初面背书内容。</FieldDescription>
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="endorsement-body">正文（选填）</FieldLabel>
                      <Textarea
                        id="endorsement-body"
                        disabled={busy === 'save'}
                        maxLength={12000}
                        value={modal.draft.body}
                        placeholder="待补充"
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, body: event.target.value },
                          })
                        }
                      />
                      <FieldDescription className="endorsement-character-count">
                        {modal.draft.body.length.toLocaleString()} / 12,000 字
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {modal.kind === 'enterprise' && aiNotice && (
                  <p className="enterprise-ai-notice" role="status">
                    {aiNotice}
                  </p>
                )}
              </div>
            </div>
            <div className="enterprise-dialog-footer">
              <Button
                type="button"
                variant="outline"
                disabled={busy === 'save'}
                onClick={closeModal}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  busy !== '' ||
                  (modal.kind === 'enterprise' && modal.draft.name.trim().length === 0)
                }
              >
                {busy === 'save'
                  ? '保存中…'
                  : modal.kind === 'enterprise'
                    ? modal.draft.id
                      ? '保存修改'
                      : '创建企业'
                    : '保存'}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}

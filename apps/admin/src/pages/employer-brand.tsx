import Select from '@douyinfe/semi-ui/lib/es/select';
import { ArrowLeft, Building2, Download, Plus, Sparkles } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

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

function downloadEnterprises(rows: Enterprise[]) {
  const columns: [keyof Enterprise, string][] = [
    ['id', '企业编号'],
    ['name', '企业名称'],
    ['industry', '行业'],
    ['introduction', '企业简介'],
    ['remark', '备注'],
    ['sort_order', '排序'],
    ['enabled', '状态'],
    ['completed_categories', '已补充分类数'],
  ];
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [
    columns.map(([, label]) => quote(label)).join(','),
    ...rows.map((row) =>
      columns
        .map(([key]) => quote(key === 'enabled' ? (row.enabled ? '已启用' : '已停用') : row[key]))
        .join(','),
    ),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `企业列表-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

  const enterprises = workspace?.enterprises ?? [];
  const deletedEnterprises = workspace?.deleted_enterprises ?? [];
  const endorsements = workspace?.endorsements ?? [];
  const selectedEnterprise = enterprises.find((item) => item.id === selectedEnterpriseId) ?? null;
  const visibleEnterprises = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return enterprises.filter((item) => {
      const matchesSearch =
        !keyword ||
        [item.name, item.industry, item.id].some((value) =>
          String(value).toLocaleLowerCase().includes(keyword),
        );
      const matchesStatus =
        status === 'all' || (status === 'enabled' ? item.enabled : !item.enabled);
      return matchesSearch && matchesStatus;
    });
  }, [enterprises, search, status]);

  function openEnterpriseForm(item?: Enterprise) {
    setFormError('');
    setAiNotice('');
    setModal({
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
    setFormError('');
    setAiNotice('');
    setModal({
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

  function closeModal() {
    setModal(null);
    setFormError('');
    setAiNotice('');
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
    try {
      const suggestion = await api<{ industry: string; introduction: string }>(
        'employer-brand/enterprise-suggestion/',
        { name: modal.draft.name.trim(), industry: modal.draft.industry },
      );
      if (!suggestion.industry && !suggestion.introduction) {
        setFormError('AI 暂时无法形成可靠建议，表单内容未更改。');
        return;
      }
      setModal((current) => {
        if (current?.kind !== 'enterprise') return current;
        return {
          ...current,
          draft: {
            ...current.draft,
            industry: suggestion.industry || current.draft.industry,
            introduction: suggestion.introduction || current.draft.introduction,
          },
        };
      });
      setAiNotice(
        '已填入 AI 建议（行业 / 企业简介），仅供参考。请核对修改后再保存；未保存前不会写入任何数据。',
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function saveModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || busy) return;
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
      closeModal();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function deleteEnterprise(item: Enterprise) {
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

  return (
    <section className="enterprise-brand-page" aria-labelledby="enterprise-brand-title">
      {error && <ErrorNotice message={error} retry={() => void load()} />}
      {notice && (
        <Alert>
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
                  variant="destructive"
                  disabled={busy === `delete-${selectedEnterprise.id}`}
                  onClick={() => void deleteEnterprise(selectedEnterprise)}
                >
                  删除企业
                </Button>
              </div>
            </div>
            <div>
              <h1 id="enterprise-brand-title">{selectedEnterprise.name}</h1>
              <p>维护这家企业的七类背书内容；空白分类会标注为「待补充」。</p>
            </div>
          </header>
          <div className="endorsement-category-grid">
            {categories.map((category) => {
              const rows = endorsements.filter(
                (item) =>
                  item.enterprise_id === selectedEnterprise.id && item.category === category.value,
              );
              const complete = rows.some((item) => item.title.trim() || item.body.trim());
              return (
                <section className="endorsement-category-card" key={category.value}>
                  <div className="endorsement-category-heading">
                    <div>
                      <h2>{category.label}</h2>
                      <Badge variant={complete ? 'secondary' : 'outline'}>
                        {complete ? '已补充' : '待补充'}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEndorsementForm(category.value)}
                    >
                      <Plus data-icon="inline-start" />
                      新增内容
                    </Button>
                  </div>
                  {rows.length ? (
                    <div className="endorsement-items">
                      {rows.map((item) => (
                        <article className="endorsement-item" key={item.id}>
                          <div className="endorsement-item-heading">
                            <h3>{item.title || '待补充'}</h3>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEndorsementForm(category.value, item)}
                            >
                              编辑
                            </Button>
                          </div>
                          <p>{item.body || '正文待补充。'}</p>
                          {!item.enabled && <Badge variant="outline">已停用</Badge>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="endorsement-empty">该分类还没有内容。</p>
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
                  <Download data-icon="inline-start" />
                  导出企业列表
                </Button>
                <Button
                  disabled={enterprises.length >= (workspace?.enterprise_limit ?? 20)}
                  onClick={() => openEnterpriseForm()}
                >
                  <Plus data-icon="inline-start" />
                  新增企业
                </Button>
              </div>
            </div>
          </header>

          <Alert className="brand-empty-content-note">
            <AlertTitle>企业资料由你创建</AlertTitle>
            <AlertDescription>
              不预置企业信息；七类背书内容初始留空并标记「待补充」。
            </AlertDescription>
          </Alert>

          <section className="brand-list-panel" aria-label="企业列表">
            <div className="brand-list-filters">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索企业名称、行业或编号…"
                aria-label="搜索企业名称、行业或编号"
              />
              <Select
                className="native-select"
                dropdownClassName="candidate-select-dropdown"
                clickToHide
                value={status}
                onChange={(value) => setStatus(typeof value === 'string' ? value : 'all')}
                aria-label="按企业状态筛选"
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
                      <span className="enterprise-card-icon">
                        <Building2 aria-hidden="true" />
                      </span>
                      <span className="enterprise-card-copy">
                        <strong>{item.name}</strong>
                        <span>
                          {item.industry || '行业待补充'} · 编号 {item.id}
                        </span>
                      </span>
                      <Badge variant={item.enabled ? 'secondary' : 'outline'}>
                        {item.enabled ? '已启用' : '已停用'}
                      </Badge>
                      <span className="enterprise-card-progress">
                        {item.completed_categories} / 7 类已补充
                      </span>
                    </button>
                    <div className="enterprise-card-actions">
                      <Button variant="ghost" size="sm" onClick={() => openEnterpriseForm(item)}>
                        编辑档案
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void deleteEnterprise(item)}>
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
                <p>先创建企业档案，再逐项补充背书内容。</p>
              </div>
            )}
          </section>

          <Alert className="brand-empty-content-note">
            <AlertDescription>
              每个租户最多维护 {workspace?.enterprise_limit ?? 20}{' '}
              家企业。删除企业不会删除其背书内容，原内容会转入「未归属 /
              已删除企业」卡片，可随时重新指定所属企业。
            </AlertDescription>
          </Alert>

          {orphanGroups.length > 0 && (
            <section className="brand-orphan-panel" aria-labelledby="brand-orphan-title">
              <div className="brand-orphan-heading">
                <div>
                  <h2 id="brand-orphan-title">未归属 / 已删除企业</h2>
                  <p>内容仍会保留；编辑内容时可以重新指定所属企业。</p>
                </div>
                <Badge variant="outline">{orphaned.length} 条内容</Badge>
              </div>
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

      <dialog
        ref={dialogRef}
        className="enterprise-dialog"
        aria-labelledby="enterprise-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeModal();
        }}
        onClose={() => {
          if (modal) setModal(null);
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
                      ? '编辑背书内容'
                      : '新增背书内容'}
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="关闭"
                onClick={closeModal}
              >
                ×
              </Button>
            </div>
            <div className="enterprise-dialog-body">
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
                        required
                        maxLength={100}
                        autoFocus
                        value={modal.draft.name}
                        placeholder="用户自行填写，不预置任何企业名"
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, name: event.target.value },
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy === 'suggest'}
                        onClick={() => void suggestEnterprise()}
                      >
                        <Sparkles data-icon="inline-start" />
                        {busy === 'suggest' ? '联想中…' : 'AI 联想'}
                      </Button>
                    </div>
                    <FieldDescription>AI 仅建议行业与简介，不会自动保存。</FieldDescription>
                  </Field>
                  <div className="enterprise-form-two-columns">
                    <Field>
                      <FieldLabel htmlFor="enterprise-industry">行业（选填）</FieldLabel>
                      <Select
                        id="enterprise-industry"
                        className="enterprise-industry-select native-select"
                        dropdownClassName="candidate-select-dropdown"
                        value={modal.draft.industry}
                        placeholder="点击选择，或直接输入"
                        filter
                        allowCreate
                        clickToHide
                        onChange={(value) =>
                          setModal({
                            ...modal,
                            draft: {
                              ...modal.draft,
                              industry: typeof value === 'string' ? value : '',
                            },
                          })
                        }
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
                        type="number"
                        min={0}
                        max={100000}
                        value={modal.draft.sort_order}
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, sort_order: Number(event.target.value) || 0 },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="enterprise-introduction">企业简介（选填）</FieldLabel>
                    <Input
                      id="enterprise-introduction"
                      maxLength={3000}
                      value={modal.draft.introduction}
                      placeholder="可由 AI 联想生成建议，提交前请核对"
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
                  {modal.draft.enterprise_id === null && (
                    <Field>
                      <FieldLabel htmlFor="endorsement-enterprise">所属企业</FieldLabel>
                      <Select
                        id="endorsement-enterprise"
                        className="native-select"
                        dropdownClassName="candidate-select-dropdown"
                        clickToHide
                        value=""
                        onChange={(value) =>
                          setModal({
                            ...modal,
                            draft: {
                              ...modal.draft,
                              enterprise_id:
                                value !== '' && value !== undefined ? Number(value) : null,
                            },
                          })
                        }
                      >
                        <Select.Option value="">未归属 / 选择企业</Select.Option>
                        {enterprises.map((item) => (
                          <Select.Option key={item.id} value={item.id}>
                            {item.name}
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <div className="enterprise-form-two-columns">
                    <Field>
                      <FieldLabel htmlFor="endorsement-category">分类</FieldLabel>
                      <Select
                        id="endorsement-category"
                        className="native-select"
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
                      <FieldLabel htmlFor="endorsement-order">展示顺序</FieldLabel>
                      <Input
                        id="endorsement-order"
                        type="number"
                        min={0}
                        max={100000}
                        value={modal.draft.sort_order}
                        onChange={(event) =>
                          setModal({
                            ...modal,
                            draft: { ...modal.draft, sort_order: Number(event.target.value) || 0 },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="endorsement-title">标题（选填）</FieldLabel>
                    <Input
                      id="endorsement-title"
                      maxLength={200}
                      value={modal.draft.title}
                      placeholder="待补充"
                      onChange={(event) =>
                        setModal({ ...modal, draft: { ...modal.draft, title: event.target.value } })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="endorsement-body">正文（选填）</FieldLabel>
                    <Textarea
                      id="endorsement-body"
                      maxLength={12000}
                      value={modal.draft.body}
                      placeholder="待补充"
                      onChange={(event) =>
                        setModal({ ...modal, draft: { ...modal.draft, body: event.target.value } })
                      }
                    />
                  </Field>
                  <label className="enterprise-enabled-option">
                    <input
                      type="checkbox"
                      checked={modal.draft.enabled}
                      onChange={(event) =>
                        setModal({
                          ...modal,
                          draft: { ...modal.draft, enabled: event.target.checked },
                        })
                      }
                    />
                    启用（停用后不进入 AI 初面背书内容）
                  </label>
                </FieldGroup>
              )}
              {modal.kind === 'enterprise' && aiNotice && (
                <p className="enterprise-ai-notice" role="status">
                  {aiNotice}
                </p>
              )}
            </div>
            <div className="enterprise-dialog-footer">
              <Button type="button" variant="outline" onClick={closeModal}>
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
                    : '保存内容'}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Job, Me } from '@/lib/api';
import { ProfileEditor } from '@/pages/job-detail';

export function ProfileDraft({
  me,
  close,
  created,
}: {
  me: Me;
  close: () => void;
  created: (job: Job) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const department = me.departments[0];
  const approver = department?.approvers[0];
  function requestClose() {
    if (!busy && (!dirty || window.confirm('画像内容还没保存，确定关闭吗？'))) close();
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent side="top" className="profile-settings-dialog">
        <SheetHeader className="profile-settings-header">
          <SheetTitle>新建画像</SheetTitle>
          <SheetDescription className="sr-only">填写招聘需求和岗位画像字段。</SheetDescription>
        </SheetHeader>
        <ProfileEditor
          job={null}
          busy={busy}
          setBusy={setBusy}
          onDirty={() => setDirty(true)}
          cancel={requestClose}
          saved={created}
          creation={{
            requestId,
            department: department?.id ?? 0,
            approver: approver?.id ?? 0,
            ready: Boolean(department && approver),
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

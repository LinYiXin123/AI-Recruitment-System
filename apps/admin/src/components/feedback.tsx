import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>操作暂未完成</AlertTitle>
      <AlertDescription>
        {message}
        {retry && (
          <Button variant="outline" onClick={retry}>
            重新加载
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Blank({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  );
}
export function Loading() {
  return (
    <div role="status" aria-label="正在加载" className="flex flex-col gap-4 p-6">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
export function Pager({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        共 {count} 条 · 第 {page} 页
      </span>
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={page * 20 >= count}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}

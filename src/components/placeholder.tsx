export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {description && <p className="text-sm text-slate-500">{description}</p>}
    </div>
  );
}

/** 아직 만들지 않은 기능 자리 */
export function Todo({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 rounded border border-dashed border-slate-300 p-3 text-sm text-slate-500">다음 단계: {children}</p>;
}

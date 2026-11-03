export function SetupNotice() {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Supabase 환경변수가 설정되지 않았습니다.</p>
      <p className="mt-1">
        <code>.env.example</code>을 <code>.env.local</code>로 복사하고 Supabase 프로젝트의 URL과 키를 넣은 뒤 서버를 다시 시작하세요.
        자세한 순서는 <code>README.md</code>에 있습니다.
      </p>
    </div>
  );
}

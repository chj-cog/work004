import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈 폴더의 다른 package-lock.json을 프로젝트 루트로 잘못 잡지 않도록
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  experimental: {
    // 엑셀 가져오기: 파일 2MB + 미리보기 표를 다시 보내는 크기. Vercel 요청 한도(4.5MB) 안
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;

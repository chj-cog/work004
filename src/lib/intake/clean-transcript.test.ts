import { describe, expect, it } from "vitest";
import { cleanTranscript } from "./clean-transcript";

describe("받아 적은 글 다듬기", () => {
  it("끝에 붙은 인사말을 뗀다", () => {
    expect(cleanTranscript("라벨 700장 남았어요. 감사합니다.")).toBe("라벨 700장 남았어요.");
    expect(cleanTranscript("나사 세 박스 있어요 시청해 주셔서 감사합니다")).toBe("나사 세 박스 있어요");
  });
  it("앞이나 중간의 말은 건드리지 않는다", () => {
    expect(cleanTranscript("감사합니다 나사 두 박스 있어요")).toBe("감사합니다 나사 두 박스 있어요");
    expect(cleanTranscript("  나사 두 박스  ")).toBe("나사 두 박스");
  });
});

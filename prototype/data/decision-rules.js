/*
 * Bộ quy tắc vị trí mẫu cho Phụ lục I.1, Bảng 1 – Phường Biên Hòa.
 * Mỗi đoạn đường chính trong dữ liệu mẫu có 01 dòng đường chính và 06 dòng kế tiếp:
 * 3 nhóm đấu nối trực tiếp, 3 nhóm không đấu nối trực tiếp.
 */
window.BAO_TIN_DECISION_RULES = {
  decision: "03/2026/QĐ-UBND",
  appendix: "Phụ lục I.1",
  table: "Bảng 1",
  commune: "Phường Biên Hòa",
  geometryMainThresholdM: 20,
  geometryCandidateThresholdM: 200,
  branchPattern: {
    direct: { recordOffsets: { A: 1, B: 2, C: 3 } },
    indirect: { recordOffsets: { A: 4, B: 5, C: 6 } }
  },
  classifyBranch({ surface, width, distance }) {
    if (surface !== "paved") {
      return {
        ok: false,
        code: "SURFACE_UNSUPPORTED",
        message: "Dữ liệu mẫu hiện chỉ tích hợp nhóm đường nhựa, bê tông xi măng của Bảng 1."
      };
    }
    if (!["gte5", "3to5", "lt3"].includes(width)) {
      return { ok: false, code: "WIDTH_REQUIRED", message: "Cần xác nhận bề rộng đường." };
    }
    const d = Number(distance);
    if (!Number.isFinite(d) || d < 0) {
      return { ok: false, code: "DISTANCE_REQUIRED", message: "Cần xác nhận khoảng cách áp dụng đến đường chính." };
    }

    if (width === "gte5") {
      return {
        ok: true,
        bucket: d <= 600 ? "A" : "B",
        condition: d <= 600 ? "Bề rộng ≥5 m, khoảng cách ≤600 m" : "Bề rộng ≥5 m, khoảng cách >600 m"
      };
    }
    if (width === "3to5") {
      if (d <= 400) return { ok: true, bucket: "A", condition: "Bề rộng từ ≥3 m đến <5 m, khoảng cách ≤400 m" };
      if (d <= 600) return { ok: true, bucket: "B", condition: "Bề rộng từ ≥3 m đến <5 m, khoảng cách >400 m đến ≤600 m" };
      return { ok: true, bucket: "C", condition: "Bề rộng từ ≥3 m đến <5 m, khoảng cách >600 m" };
    }
    return d <= 200
      ? { ok: true, bucket: "B", condition: "Bề rộng <3 m, khoảng cách ≤200 m" }
      : { ok: true, bucket: "C", condition: "Bề rộng <3 m, khoảng cách >200 m" };
  }
};

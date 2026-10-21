// 8-4-4 secondary school scale, A to E, as selected for this deployment.
// Bands are descending minimum marks; points feed the mean grade.
export const BANDS = [
  { grade: "A", min: 80, max: 100, points: 5, remark: "Excellent" },
  { grade: "B", min: 75, max: 79, points: 4, remark: "Very good" },
  { grade: "C", min: 65, max: 74, points: 3, remark: "Good" },
  { grade: "D", min: 50, max: 64, points: 2, remark: "Fair" },
  { grade: "E", min: 0, max: 49, points: 1, remark: "Needs support" },
];

export function bandFor(marks) {
  return BANDS.find((band) => marks >= band.min) ?? BANDS[BANDS.length - 1];
}

export function gradeFor(marks) {
  return bandFor(marks).grade;
}

export function pointsFor(marks) {
  return bandFor(marks).points;
}

// Mean grade comes from mean points so it stays on the same scale.
export function meanGrade(points) {
  const rounded = Math.max(1, Math.min(5, Math.round(points)));
  return BANDS.find((band) => band.points === rounded) ?? BANDS[BANDS.length - 1];
}

export function aggregate(entries) {
  if (!entries.length) return null;
  const totalMarks = entries.reduce((sum, e) => sum + e.marks, 0);
  const totalPoints = entries.reduce((sum, e) => sum + e.points, 0);
  const meanMarks = totalMarks / entries.length;
  const meanPoints = totalPoints / entries.length;
  const band = meanGrade(meanPoints);
  return {
    subjects: entries.length,
    totalMarks,
    totalPoints,
    meanMarks: Math.round(meanMarks * 100) / 100,
    meanPoints: Math.round(meanPoints * 100) / 100,
    meanGrade: band.grade,
    remark: band.remark,
  };
}

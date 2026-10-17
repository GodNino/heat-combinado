// Shared by personal progress, team detail and printable training summaries.
export type LearningResult = {menu_item_id: string; correct: number; total: number; needs_review?: boolean};
export function learningStatus(result?: LearningResult) {
  if (!result || result.total <= 0) return 'Not completed';
  if (result.needs_review) return 'Updated - review needed';
  return result.correct / result.total >= 0.8 ? 'At target' : 'Needs practice';
}
export function summarizeLearning(items: readonly {id: string}[], results: readonly LearningResult[]) {
  const ids = new Set(items.map(item => item.id));
  const scores = results.filter(row => ids.has(row.menu_item_id) && row.total > 0);
  const correct = scores.reduce((sum, row) => sum + row.correct, 0);
  const answered = scores.reduce((sum, row) => sum + row.total, 0);
  const atTarget = scores.filter(row => learningStatus(row) === 'At target').length;
  return {scores, completed: scores.length, total: ids.size, correct, answered,
    accuracy: answered ? Math.round(correct / answered * 100) : null,
    completion: ids.size ? Math.round(scores.length / ids.size * 100) : 0,
    atTarget, review: scores.length - atTarget, pending: ids.size - scores.length};
}

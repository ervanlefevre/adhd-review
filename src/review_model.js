// Pure functions: no DOM, no chrome.* access. Unit-tested with node --test.
import { OTHER_GROUP_LABEL } from "./rules.js";

export const DEFAULT_LINE_CAP = 150;

export function changedLines(file) {
  return (file.additions || 0) + (file.deletions || 0);
}

// Returns a new array of files in review order, each tagged with its group label,
// its rule index, its group weight and its progress weight.
export function orderFiles(files, rules, { lineCap = DEFAULT_LINE_CAP } = {}) {
  const tagged = files.map((file) => {
    const ruleIndex = rules.findIndex((rule) => rule.pattern.test(file.path));
    const rule = ruleIndex === -1 ? null : rules[ruleIndex];
    const groupWeight = rule ? rule.weight : 1;
    const cappedLines = Math.max(1, Math.min(changedLines(file), lineCap));
    return {
      ...file,
      group: rule ? rule.label : OTHER_GROUP_LABEL,
      ruleIndex: ruleIndex === -1 ? rules.length : ruleIndex,
      weight: cappedLines * groupWeight,
    };
  });
  return tagged.sort((a, b) => a.ruleIndex - b.ruleIndex || a.path.localeCompare(b.path));
}

export function isViewed(file) {
  return file.viewerViewedState === "VIEWED";
}

// Groups ordered files (output of orderFiles) into [{ label, files, viewedFiles, totalFiles, percent }].
export function groupFiles(orderedFiles) {
  const groups = [];
  let current = null;
  for (const file of orderedFiles) {
    if (!current || current.label !== file.group) {
      current = { label: file.group, files: [], viewedFiles: 0, totalFiles: 0, viewedWeight: 0, totalWeight: 0 };
      groups.push(current);
    }
    current.files.push(file);
    current.totalFiles += 1;
    current.totalWeight += file.weight;
    if (isViewed(file)) {
      current.viewedFiles += 1;
      current.viewedWeight += file.weight;
    }
  }
  for (const group of groups) {
    group.percent = percentage(group.viewedWeight, group.totalWeight);
  }
  return groups;
}

export function progress(orderedFiles) {
  let viewedWeight = 0;
  let totalWeight = 0;
  let viewedFiles = 0;
  let remainingLines = 0;
  for (const file of orderedFiles) {
    totalWeight += file.weight;
    if (isViewed(file)) {
      viewedWeight += file.weight;
      viewedFiles += 1;
    } else {
      remainingLines += changedLines(file);
    }
  }
  return {
    percent: percentage(viewedWeight, totalWeight),
    viewedFiles,
    totalFiles: orderedFiles.length,
    remainingLines,
  };
}

function percentage(part, whole) {
  if (whole === 0) return 100;
  return Math.round((part / whole) * 100);
}

// Neighbour in review order. direction: 1 or -1. Wraps around.
export function neighbourFile(orderedFiles, currentPath, direction) {
  if (orderedFiles.length === 0) return null;
  const index = orderedFiles.findIndex((file) => file.path === currentPath);
  if (index === -1) return direction > 0 ? orderedFiles[0] : orderedFiles[orderedFiles.length - 1];
  const next = (index + direction + orderedFiles.length) % orderedFiles.length;
  return orderedFiles[next];
}

// Next file after currentPath that is neither viewed nor flagged "later"; wraps around; null when none.
export function nextPendingFile(orderedFiles, currentPath, laterPaths = new Set()) {
  if (orderedFiles.length === 0) return null;
  const start = orderedFiles.findIndex((file) => file.path === currentPath);
  for (let step = 1; step <= orderedFiles.length; step += 1) {
    const candidate = orderedFiles[(start + step) % orderedFiles.length];
    if (!isViewed(candidate) && !laterPaths.has(candidate.path)) return candidate;
  }
  return null;
}

export function positionInGroup(groups, path) {
  for (const group of groups) {
    const index = group.files.findIndex((file) => file.path === path);
    if (index !== -1) return { group, index: index + 1, total: group.files.length };
  }
  return null;
}

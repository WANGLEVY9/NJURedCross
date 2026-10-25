import { readProfileCandidatesByIds } from '../identity/profile-query.js';

function text(value) {
  return String(value ?? '').trim();
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(cellText).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    const candidate = value.display_value ?? value.name ?? value.title ?? value.label ?? value.value;
    return candidate === value ? '' : cellText(candidate);
  }
  return text(value);
}

/**
 * Resolve public grade labels from the authoritative profile source.
 * Student ID and real name must both identify exactly one profile row.
 */
export async function readMorningGrades(client, people = []) {
  const identities = people
    .map((person) => ({
      studentId: text(person?.studentId),
      realName: text(person?.realName),
    }))
    .filter((person) => person.studentId && person.realName);
  const grades = new Map();
  const candidates = await readProfileCandidatesByIds(
    client,
    identities.map((person) => person.studentId),
  );

  for (const { studentId, realName } of identities) {
    const matches = candidates.get(studentId) || [];
    const profile = matches.length === 1 && cellText(matches[0]['姓名']) === realName
      ? matches[0]
      : null;
    grades.set(studentId, profile ? cellText(profile['年级']) : '');
  }
  return grades;
}

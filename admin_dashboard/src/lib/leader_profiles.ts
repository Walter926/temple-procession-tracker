type Profile = { displayName?: string; fullName?: string; email?: string };
export function leaderLabel(profile?: Profile, assigned = false): string {
  return profile?.displayName?.trim() || profile?.fullName?.trim() || profile?.email?.trim() || (assigned ? 'Assigned leader (profile unavailable)' : 'Team leader (profile unavailable)');
}
export function eligibleLeader(profile: { role: string; isActive: boolean; isEligible?: boolean; profileMissing?: boolean; assignedGroupId?: string }, groupId: string): boolean {
  return profile.isEligible !== false && !profile.profileMissing && profile.role === 'teamLeader' && profile.isActive === true && (!profile.assignedGroupId || profile.assignedGroupId === groupId);
}
export function mergeProfiles<T extends { id: string }>(...pages: T[][]): T[] {
  const result = new Map<string, T>();
  for (const page of pages) for (const profile of page) result.set(profile.id, profile);
  return [...result.values()];
}

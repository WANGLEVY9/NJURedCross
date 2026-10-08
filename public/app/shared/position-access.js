/** Mirrors the events module visibility; the server independently authorizes every read. */
export function canViewPositionRoster(session) {
  const user = session?.user;
  return session?.authenticated === true && user?.consoleAccess === true &&
    (user.role === 'super_admin' ||
      user.role === 'platform_admin' && Array.isArray(user.permissions) && user.permissions.includes('events'));
}

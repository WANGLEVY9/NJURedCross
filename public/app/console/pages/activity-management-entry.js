/** All activity management uses the unified workspace. Historical records are
 * adapted inside this workspace instead of routing back to the former page. */
export default async function activityManagementEntry(context,shell){
  return (await import('./activity-workspace-page.js')).default(context,shell);
}

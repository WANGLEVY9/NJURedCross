/** Every activity entry uses the inline workspace. Existing records remain
 * stored; old URLs and unavailable providers never select a second UI. */
export default async function activityManagementEntry(context,shell){
  return (await import('./activity-workspace-page.js')).default(context,shell);
}

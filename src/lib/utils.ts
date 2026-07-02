/** Join truthy class names — a dependency-free `clsx` for the common case. */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

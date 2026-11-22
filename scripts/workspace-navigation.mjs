// Exercise the workspace index through the same controls presented to a visitor.
export async function navigateWorkspace(page, name) {
  const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("navigation", { name: "Workspaces", exact: true })
    .getByRole("button", { name: new RegExp("^" + name + "(?:\\s|$)", "i") }).click();
  const hash = "#" + name.toLowerCase().replaceAll(" ", "-");
  await page.waitForFunction(expected => location.hash === expected, hash);
}

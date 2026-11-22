import "@fontsource-variable/dm-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@xyflow/react/dist/style.css";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MONOLITH — Intelligence workspace",
  description:
    "Evidence-linked operational intelligence for Northstar Commerce.",
  icons: { icon: "/mark.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

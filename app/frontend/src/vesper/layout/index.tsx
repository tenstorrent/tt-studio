// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type ReactNode } from "react";
import { Footer } from "./components/footer";
import { Header } from "./components/header";
import { Sidebar } from "./components/sidebar";

export function Layout({
  title,
  children,
  hideHeader = false,
  hideSidebar = false,
  hideFooter = false,
}: {
  title?: string;
  children?: ReactNode;
  hideHeader?: boolean;
  hideSidebar?: boolean;
  hideFooter?: boolean;
}) {
  return (
    <div className="fixed inset-0 flex bg-vesper-dot-pattern-primary">
      {!hideSidebar && <Sidebar />}
      <div className="flex-1 flex flex-col h-full shrink min-w-0">
        {!hideHeader && <Header title={title} />}
        <main className="flex-1 shrink min-h-0 overflow-auto">{children}</main>
        {!hideFooter && <Footer />}
      </div>
    </div>
  );
}

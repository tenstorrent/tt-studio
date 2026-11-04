// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@tenstorrent/vesper/button";
import { Typography } from "@tenstorrent/vesper/typography";
import { getErrorMessage } from "@/src/utils/errors";
import { EmptyPill } from "./empty-pill";

interface PageErrorBoundaryProps {
  children?: ReactNode;
}

interface PageErrorBoundaryState {
  error: unknown;
  hasError: boolean;
}

/**
 * Catches a render error in a page so it replaces only that page, rather than
 * unmounting the whole app (sidebar and header included). Remount it with a
 * new `key` to clear the error, e.g. when the route changes.
 */
export class PageErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): PageErrorBoundaryState {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Page crashed:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-full flex flex-col items-center justify-center gap-vesper-4 p-vesper-10 text-center"
      >
        <EmptyPill>Something went wrong on this page</EmptyPill>
        <Typography
          variant="copy-sm"
          className="max-w-md text-vesper-text-secondary"
        >
          The rest of TT-Studio still works. Try again, or reload the page. If
          it keeps happening, report a bug from Settings.
        </Typography>
        <Typography
          as="pre"
          variant="label-xs-mono"
          className="max-w-2xl max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-vesper-1 p-vesper-3 bg-vesper-tint-neutral-200 text-vesper-text-secondary text-left"
        >
          {getErrorMessage(this.state.error)}
        </Typography>
        <div className="flex gap-vesper-3">
          <Button type="button" size="sm" variant="tertiary" onClick={this.reset}>
            Try again
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload page
          </Button>
        </div>
      </div>
    );
  }
}

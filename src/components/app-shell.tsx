"use client";

import { useState, useEffect, useCallback } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar";

const STORAGE_KEY = "sidebar-collapsed";

interface AppShellProps {
  userEmail?: string;
  children: React.ReactNode;
}

export function AppShell({ userEmail, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const openMobile = useCallback(() => {
    setMobileOpen(true);
  }, []);

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar — fixed position, hidden on mobile */}
      <div
        className={cn(
          "hidden lg:block fixed inset-y-0 left-0 z-30 transition-all duration-200",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          userEmail={userEmail}
        />
      </div>

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMobile}
          />
          {/* Sidebar panel */}
          <div className="relative z-10 h-full w-64">
            <Sidebar
              collapsed={false}
              userEmail={userEmail}
              onNavClick={closeMobile}
            />
          </div>
          {/* Close button */}
          <button
            onClick={closeMobile}
            className="absolute right-4 top-4 z-20 rounded-lg p-1 text-slate-400 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Main content area */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-all duration-200 pr-2 lg:pr-3",
          collapsed ? "lg:ml-16" : "lg:ml-64"
        )}
      >
        {/* Mobile header */}
        <div className="flex h-14 items-center border-b bg-white px-4 lg:hidden">
          <button
            onClick={openMobile}
            className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <Menu className="h-6 w-6" />
          </button>
          <span className="ml-3 font-semibold text-slate-900">GTM OS</span>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-slate-50 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus,
  UserCog,
  Plug,
  Building2,
  Users,
  Kanban,
  Activity,
  LogOut,
  PanelLeftClose,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { name: "Nova Busca", href: "/dashboard", icon: Plus },
  { name: "Perfil ICP", href: "/settings", icon: UserCog },
  { name: "Integracoes", href: "/settings/integrations", icon: Plug },
  { name: "Empresas", href: "/companies", icon: Building2 },
  { name: "Leads", href: "/contacts", icon: Users },
  { name: "Pipeline", href: "/pipeline", icon: Kanban },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavClick?: () => void;
  userEmail?: string;
}

export function Sidebar({ collapsed, onToggle, onNavClick, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // When collapsed, clicking anywhere on sidebar expands it
  function handleSidebarClick() {
    if (collapsed && onToggle) {
      onToggle();
    }
  }

  return (
    <aside
      onClick={collapsed ? handleSidebarClick : undefined}
      className={cn(
        "relative flex h-screen flex-col bg-slate-900 transition-all duration-200",
        collapsed ? "w-16 cursor-pointer" : "w-64"
      )}
    >
      {/* Logo + Toggle */}
      <div
        className={cn(
          "flex h-16 items-center",
          collapsed ? "justify-center px-0" : "justify-between px-6"
        )}
      >
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-6 w-6 shrink-0 text-indigo-500" />
          {!collapsed && (
            <h1 className="text-xl font-bold text-white">GTM OS</h1>
          )}
        </div>
        {!collapsed && onToggle && (
          <button
            onClick={onToggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="Recolher sidebar"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
        <div className="space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                onClick={(e) => {
                  if (collapsed) {
                    e.preventDefault();
                    return;
                  }
                  onNavClick?.();
                }}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-colors",
                  collapsed
                    ? "justify-center px-0 py-2"
                    : "gap-3 px-3 py-2",
                  isActive && !collapsed
                    ? "border-l-2 border-indigo-400 bg-indigo-500/10 text-indigo-400"
                    : isActive && collapsed
                      ? "bg-indigo-500/10 text-indigo-400"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && item.name}
              </Link>
            );
          })}
        </div>

        {/* Execuções section */}
        <div className="mt-6">
          {!collapsed && (
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Execuções
            </p>
          )}
          {collapsed ? (
            <div className="flex justify-center py-2" title="Execuções">
              <Activity className="h-5 w-5 text-slate-500" />
            </div>
          ) : (
            <Link
              href="/runs"
              onClick={(e) => {
                if (collapsed) {
                  e.preventDefault();
                  return;
                }
                onNavClick?.();
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === "/runs"
                  ? "border-l-2 border-indigo-400 bg-indigo-500/10 text-indigo-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <Activity className="h-5 w-5 shrink-0" />
              Ver todas
            </Link>
          )}
        </div>
      </nav>

      {/* User section */}
      <div
        className={cn(
          "border-t border-slate-700 py-4",
          collapsed ? "px-2" : "px-4"
        )}
      >
        {userEmail && !collapsed && (
          <p className="mb-2 truncate text-xs text-slate-500">{userEmail}</p>
        )}
        {!collapsed && (
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Sair
          </button>
        )}
        {collapsed && (
          <div className="flex justify-center">
            <LogOut className="h-5 w-5 text-slate-500" />
          </div>
        )}
      </div>
    </aside>
  );
}
